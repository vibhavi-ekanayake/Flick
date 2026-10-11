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

  // Track connected peers in-memory
  // Map<socketId, PeerInfo>
  const peers = new Map();

  io.on('connection', (socket) => {
    const clientIp = socket.handshake.address;

    // 1. Peer announces presence and profile
    socket.on('join', (peerProfile) => {
      const peerData = {
        id: socket.id,
        name: peerProfile.name || `Device-${socket.id.slice(0, 4)}`,
        deviceType: peerProfile.deviceType || 'desktop',
        os: peerProfile.os || 'unknown',
        color: peerProfile.color || '#0A84FF',
        ip: clientIp,
        joinedAt: Date.now(),
      };

      peers.set(socket.id, peerData);
      socket.data.peer = peerData;

      // Send the current list of other peers to this newly connected peer
      const currentPeers = Array.from(peers.values()).filter((p) => p.id !== socket.id);
      socket.emit('peers-list', currentPeers);

      // Broadcast this new peer's arrival to all other connected peers
      socket.broadcast.emit('peer-joined', peerData);

      console.log(`[+] Peer Connected: ${peerData.name} (${socket.id}) [${peerData.deviceType} / ${peerData.os}]`);
    });

    // 2. Profile updates (e.g. user renamed their device)
    socket.on('update-profile', (updates) => {
      if (peers.has(socket.id)) {
        const existing = peers.get(socket.id);
        const updated = { ...existing, ...updates, id: socket.id };
        peers.set(socket.id, updated);
        socket.data.peer = updated;
        socket.broadcast.emit('peer-updated', updated);
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

    // 6. Pre-transfer Request / Approval Handshake
    socket.on('transfer-request', ({ to, fileMeta }) => {
      io.to(to).emit('transfer-request', {
        from: socket.id,
        senderPeer: socket.data.peer,
        fileMeta,
      });
    });

    socket.on('transfer-response', ({ to, accepted, fileId }) => {
      io.to(to).emit('transfer-response', {
        from: socket.id,
        accepted,
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

    // 8. Disconnect handling
    socket.on('disconnect', () => {
      if (peers.has(socket.id)) {
        const peer = peers.get(socket.id);
        peers.delete(socket.id);
        socket.broadcast.emit('peer-left', { id: socket.id });
        console.log(`[-] Peer Disconnected: ${peer.name} (${socket.id})`);
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
