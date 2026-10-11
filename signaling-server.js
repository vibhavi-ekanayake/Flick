/**
 * Flick - Standalone WebRTC Signaling Server
 * 
 * Deploy this file to Render, Railway, Fly.io, or VPS.
 * Provides persistent WebSocket handshaking for Flick clients hosted on Vercel.
 */

const { createServer } = require('http');
const { Server } = require('socket.io');

const port = parseInt(process.env.PORT || '3001', 10);

const httpServer = createServer((req, res) => {
  // Health check endpoint
  if (req.url === '/health' || req.url === '/') {
    const forwarded = req.headers['cf-connecting-ip'] || req.headers['x-real-ip'] || req.headers['x-forwarded-for'];
    const clientIp = (forwarded ? forwarded.split(',')[0].trim() : req.socket.remoteAddress) || 'unknown';
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      name: 'Flick Signaling Server',
      yourIp: clientIp,
      yourRoom: `wifi_${clientIp}`,
      activeRooms: rooms.size,
      connectedSockets: socketsInfo.size,
    }));
    return;
  }
  res.writeHead(404);
  res.end('Not Found');
});

const io = new Server(httpServer, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
  transports: ['websocket', 'polling'],
  maxHttpBufferSize: 1e8,
});

// Helper to determine the network room key for a given client socket
function getClientNetworkRoom(socket) {
  // Priority: Cloudflare -> x-real-ip -> x-forwarded-for -> socket address
  const forwarded =
    socket.handshake.headers['cf-connecting-ip'] ||
    socket.handshake.headers['x-real-ip'] ||
    socket.handshake.headers['x-forwarded-for'];

  let ip = '';
  if (forwarded) {
    ip = forwarded.split(',')[0].trim();
  } else {
    ip = socket.handshake.address || '';
  }

  if (ip.startsWith('::ffff:')) {
    ip = ip.substring(7);
  }

  // When deployed to Render in the cloud:
  // All devices connected to the SAME Wi-Fi router share the exact same Public IP.
  // A phone on Mobile Data (Cellular 4G/5G) has a completely DIFFERENT carrier IP.
  // Isolating by this IP guarantees Mobile Data and Wi-Fi NEVER see each other!
  if (ip && ip !== '::1' && ip !== '127.0.0.1' && ip !== 'localhost') {
    return `wifi_${ip}`;
  }

  return 'wifi_local';
}

// Sockets and Rooms tracking
// socketsInfo: Map<socketId, { socket, room, deviceId, peerData }>
const socketsInfo = new Map();

// rooms: Map<roomName, Map<deviceId, { primarySocketId: string, sockets: Set<string>, peerData: object }>>
const rooms = new Map();

io.on('connection', (socket) => {
  // 1. Peer announcement
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

  // 2. Profile update
  socket.on('update-profile', (updates) => {
    const info = socketsInfo.get(socket.id);
    if (info) {
      info.peerData = { ...info.peerData, ...updates };
      socket.data.peer = info.peerData;

      const roomDevices = rooms.get(info.room);
      if (roomDevices && roomDevices.has(info.deviceId)) {
        const deviceEntry = roomDevices.get(info.deviceId);
        deviceEntry.peerData = { ...deviceEntry.peerData, ...updates };
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

  // 8. Disconnect
  socket.on('disconnect', () => {
    const info = socketsInfo.get(socket.id);
    if (info) {
      socketsInfo.delete(socket.id);
      const roomDevices = rooms.get(info.room);
      if (roomDevices && roomDevices.has(info.deviceId)) {
        const deviceEntry = roomDevices.get(info.deviceId);
        deviceEntry.sockets.delete(socket.id);

        if (deviceEntry.sockets.size === 0) {
          roomDevices.delete(info.deviceId);
          socket.to(info.room).emit('peer-left', { id: socket.id, deviceId: info.deviceId });
          console.log(`[-] Device Left [${info.room}]: ${info.peerData.name} (${info.deviceId})`);
        } else {
          deviceEntry.primarySocketId = Array.from(deviceEntry.sockets)[0];
          deviceEntry.peerData.id = deviceEntry.primarySocketId;
          console.log(`[~] Tab Closed for Device: ${info.peerData.name} (${deviceEntry.sockets.size} tab(s) remaining)`);
        }
      }
    }
  });
});

httpServer.listen(port, '0.0.0.0', () => {
  console.log(`Flick Signaling Server running on port ${port}`);
});
