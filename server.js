/**
 * Antigravity - Local Network Discovery & WebRTC Signaling Server
 * 
 * Powered by Node.js, HTTP, and Socket.io.
 * Serves Next.js on http://0.0.0.0:3000 so any device on the local WiFi can access it.
 */

const { createServer } = require('http');
const { parse } = require('url');
const next = require('next');
const { Server } = require('socket.io');
const os = require('os');

const fs = require('fs');
const path = require('path');

const hasBuild = fs.existsSync(path.join(__dirname, '.next', 'BUILD_ID'));
const dev = process.env.NODE_ENV === 'development' || (!hasBuild && process.env.NODE_ENV !== 'production');
const hostname = '0.0.0.0';
const port = parseInt(process.env.PORT || '3000', 10);

// Initialize Next.js app
const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();


// Helper to determine the local machine's primary LAN IP addresses
function getLocalIpAddresses() {
  const interfaces = os.networkInterfaces();
  const addresses = [];
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      // Filter for IPv4 and non-internal (not 127.0.0.1)
      if (iface.family === 'IPv4' && !iface.internal) {
        addresses.push({ iface: name, address: iface.address });
      }
    }
  }
  return addresses;
}

app.prepare().then(() => {
  const httpServer = createServer(async (req, res) => {
    try {
      const parsedUrl = parse(req.url, true);
      await handle(req, res, parsedUrl);
    } catch (err) {
      console.error('Error handling request:', err);
      res.statusCode = 500;
      res.end('Internal Server Error');
    }
  });

  // Attach Socket.io server with permissive CORS for local network flexibility
  const io = new Server(httpServer, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST'],
    },
    transports: ['websocket', 'polling'],
    maxHttpBufferSize: 1e8, // 100MB buffer for any signaling data
  });

  // Determine primary host LAN subnet prefix for mapping localhost connections
  const localIps = getLocalIpAddresses();
  let primaryHostLanPrefix = '';
  for (const item of localIps) {
    const parts = item.address.split('.');
    if (parts.length === 4) {
      if (parts[0] === '192' && parts[1] === '168') {
        primaryHostLanPrefix = `192.168.${parts[2]}`;
        break;
      } else if (parts[0] === '10') {
        primaryHostLanPrefix = `10.${parts[1]}.${parts[2]}`;
        break;
      } else if (parts[0] === '172') {
        primaryHostLanPrefix = `172.${parts[1]}.${parts[2]}`;
        break;
      }
    }
  }

  // Helper to determine the network room key for a given client socket
  function getClientNetworkRoom(socket) {
    const forwarded = socket.handshake.headers['x-forwarded-for'];
    let ip = (forwarded ? forwarded.split(',')[0].trim() : socket.handshake.address) || '';

    if (ip.startsWith('::ffff:')) {
      ip = ip.substring(7);
    }

    // Localhost / loopback on host machine maps to primary LAN subnet room so PC & phone discover each other
    if (ip === '::1' || ip === '127.0.0.1' || ip === 'localhost') {
      return primaryHostLanPrefix ? `wifi_${primaryHostLanPrefix}` : 'wifi_local';
    }

    const parts = ip.split('.');
    if (parts.length === 4) {
      // 192.168.x.yyy -> group by 192.168.x subnet
      if (parts[0] === '192' && parts[1] === '168') {
        return `wifi_192.168.${parts[2]}`;
      }
      // 10.x.y.zzz -> group by 10.x.y subnet
      if (parts[0] === '10') {
        return `wifi_10.${parts[1]}.${parts[2]}`;
      }
      // 172.16-31.x.y
      if (parts[0] === '172' && parseInt(parts[1], 10) >= 16 && parseInt(parts[1], 10) <= 31) {
        return `wifi_172.${parts[1]}.${parts[2]}`;
      }
      // Public IP (for cloud deployments where all devices on same Wi-Fi share public IP)
      return `wifi_pub_${ip}`;
    }

    return `wifi_${ip || 'unknown'}`;
  }

  // Socket tracking
  // socketsInfo: Map<socketId, { socket, room, deviceId, peerData }>
  const socketsInfo = new Map();

  // Rooms structure:
  // rooms: Map<roomName, Map<deviceId, { primarySocketId: string, sockets: Set<string>, peerData: object }>>
  const rooms = new Map();

  io.on('connection', (socket) => {
    // 1. Peer announces presence and profile
    socket.on('join', (peerProfile) => {
      const room = getClientNetworkRoom(socket);
      socket.join(room);

      const deviceId = peerProfile.deviceId || `dev_${socket.id}`;
      const peerData = {
        id: socket.id,
        deviceId: deviceId,
        name: peerProfile.name || `Device-${socket.id.slice(0, 4)}`,
        deviceType: peerProfile.deviceType || 'desktop',
        os: peerProfile.os || 'unknown',
        color: peerProfile.color || '#0A84FF',
        joinedAt: Date.now(),
      };

      socketsInfo.set(socket.id, {
        socket,
        room,
        deviceId,
        peerData,
      });
      socket.data.peer = peerData;
      socket.data.room = room;
      socket.data.deviceId = deviceId;

      if (!rooms.has(room)) {
        rooms.set(room, new Map());
      }
      const roomDevices = rooms.get(room);

      const isExistingDevice = roomDevices.has(deviceId);
      let deviceEntry;

      if (isExistingDevice) {
        deviceEntry = roomDevices.get(deviceId);
        deviceEntry.sockets.add(socket.id);
        deviceEntry.primarySocketId = socket.id;
        deviceEntry.peerData = { ...deviceEntry.peerData, ...peerData, id: socket.id };
      } else {
        deviceEntry = {
          primarySocketId: socket.id,
          sockets: new Set([socket.id]),
          peerData,
        };
        roomDevices.set(deviceId, deviceEntry);
      }

      // Send the list of OTHER devices in this Wi-Fi room (excluding this device's own tabs)
      const otherPeersInRoom = Array.from(roomDevices.values())
        .filter((d) => d.peerData.deviceId !== deviceId)
        .map((d) => ({ ...d.peerData, id: d.primarySocketId }));

      socket.emit('peers-list', otherPeersInRoom);

      // Only broadcast 'peer-joined' to OTHER devices in the room if this is a newly arrived device
      // (Opening extra tabs on the same device will NOT spam or duplicate device nodes)
      if (!isExistingDevice) {
        socket.to(room).emit('peer-joined', peerData);
        console.log(`[+] Device Joined [${room}]: ${peerData.name} (${deviceId}) [${peerData.deviceType} / ${peerData.os}]`);
      } else {
        console.log(`[~] Additional Tab Connected for Device: ${peerData.name} (${deviceId}) [${socket.id}]`);
      }
    });

    // 2. Profile updates (e.g. user renamed their device)
    socket.on('update-profile', (updates) => {
      const info = socketsInfo.get(socket.id);
      if (info) {
        info.peerData = { ...info.peerData, ...updates };
        socket.data.peer = info.peerData;

        const roomDevices = rooms.get(info.room);
        if (roomDevices && roomDevices.has(info.deviceId)) {
          const deviceEntry = roomDevices.get(info.deviceId);
          deviceEntry.peerData = { ...deviceEntry.peerData, ...updates };
          // Broadcast to other devices in the same room
          socket.to(info.room).emit('peer-updated', deviceEntry.peerData);
        }
      }
    });

    // 3. WebRTC Signaling: Offer
    socket.on('signal-offer', ({ to, offer, meta }) => {
      io.to(to).emit('signal-offer', {
        from: socket.id,
        senderPeer: socket.data.peer,
        offer,
        meta,
      });
    });

    // 4. WebRTC Signaling: Answer
    socket.on('signal-answer', ({ to, answer }) => {
      io.to(to).emit('signal-answer', {
        from: socket.id,
        answer,
      });
    });

    // 5. WebRTC Signaling: ICE Candidate
    socket.on('signal-ice-candidate', ({ to, candidate }) => {
      io.to(to).emit('signal-ice-candidate', {
        from: socket.id,
        candidate,
      });
    });

    // 6. Local Socket Relay Fallback (Guaranteed 100% reliable transfer over local Wi-Fi)
    socket.on('relay-start', ({ to, fileMeta }) => {
      io.to(to).emit('relay-start', {
        from: socket.id,
        senderPeer: socket.data.peer,
        fileMeta,
      });
    });

    socket.on('relay-chunk', ({ to, fileId, chunk, index, totalChunks }) => {
      io.to(to).emit('relay-chunk', {
        from: socket.id,
        fileId,
        chunk,
        index,
        totalChunks,
      });
    });

    socket.on('relay-complete', ({ to, fileId }) => {
      io.to(to).emit('relay-complete', {
        from: socket.id,
        fileId,
      });
    });

    socket.on('relay-cancel', ({ to, fileId }) => {
      io.to(to).emit('relay-cancel', {
        from: socket.id,
        fileId,
      });
    });

    // 7. Transfer cancellation signal
    socket.on('transfer-cancel', ({ to, fileId }) => {
      io.to(to).emit('transfer-cancel', {
        from: socket.id,
        fileId,
      });
    });

    // 8. Disconnect handling with multi-tab awareness
    socket.on('disconnect', () => {
      const info = socketsInfo.get(socket.id);
      if (info) {
        socketsInfo.delete(socket.id);
        const roomDevices = rooms.get(info.room);
        if (roomDevices && roomDevices.has(info.deviceId)) {
          const deviceEntry = roomDevices.get(info.deviceId);
          deviceEntry.sockets.delete(socket.id);

          if (deviceEntry.sockets.size === 0) {
            // All tabs of this device are closed: notify other peers in room
            roomDevices.delete(info.deviceId);
            socket.to(info.room).emit('peer-left', { id: socket.id, deviceId: info.deviceId });
            console.log(`[-] Device Left [${info.room}]: ${info.peerData.name} (${info.deviceId})`);
          } else {
            // Other tab(s) still open: reassign primary socket
            deviceEntry.primarySocketId = Array.from(deviceEntry.sockets)[0];
            deviceEntry.peerData.id = deviceEntry.primarySocketId;
            console.log(`[~] Tab Closed for Device: ${info.peerData.name} (${deviceEntry.sockets.size} tab(s) remaining)`);
          }
        }
      }
    });
  });

  httpServer.listen(port, hostname, () => {
    const localIps = getLocalIpAddresses();
    console.log('\n======================================================');
    console.log('   FLICK - LOCAL P2P FILE SHARING');
    console.log('======================================================');
    console.log(` Localhost:      http://localhost:${port}`);
    if (localIps.length > 0) {
      console.log(' Wi-Fi / LAN IP:');
      localIps.forEach(({ iface, address }) => {
        console.log(`   -> http://${address}:${port}   (${iface})`);
      });
    }
    console.log(' Open this URL on your other phone/laptop on the same Wi-Fi!');
    console.log('======================================================\n');
  });
});
