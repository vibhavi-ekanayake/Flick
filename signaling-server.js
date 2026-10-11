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
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', name: 'Flick Signaling Server', peers: peers.size }));
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

const peers = new Map();

io.on('connection', (socket) => {
  const clientIp = socket.handshake.address;

  // 1. Peer announcement
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

    socket.emit('peers-list', Array.from(peers.values()).filter((p) => p.id !== socket.id));
    socket.broadcast.emit('peer-joined', peerData);

    console.log(`[+] Peer Connected: ${peerData.name} (${socket.id})`);
  });

  // 2. Profile update
  socket.on('update-profile', (updates) => {
    if (peers.has(socket.id)) {
      const existing = peers.get(socket.id);
      const updated = { ...existing, ...updates, id: socket.id };
      peers.set(socket.id, updated);
      socket.data.peer = updated;
      socket.broadcast.emit('peer-updated', updated);
    }
  });

  // 3. WebRTC Offer
  socket.on('signal-offer', ({ to, offer, meta }) => {
    io.to(to).emit('signal-offer', {
      from: socket.id,
      senderPeer: socket.data.peer,
      offer,
      meta,
    });
  });

  // 4. WebRTC Answer
  socket.on('signal-answer', ({ to, answer }) => {
    io.to(to).emit('signal-answer', {
      from: socket.id,
      answer,
    });
  });

  // 5. ICE Candidate
  socket.on('signal-ice-candidate', ({ to, candidate }) => {
    io.to(to).emit('signal-ice-candidate', {
      from: socket.id,
      candidate,
    });
  });

  // 6. Transfer Request / Response
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

  // 7. Disconnect
  socket.on('disconnect', () => {
    if (peers.has(socket.id)) {
      const peer = peers.get(socket.id);
      peers.delete(socket.id);
      socket.broadcast.emit('peer-left', { id: socket.id });
      console.log(`[-] Peer Disconnected: ${peer.name} (${socket.id})`);
    }
  });
});

httpServer.listen(port, '0.0.0.0', () => {
  console.log(`Flick Signaling Server running on port ${port}`);
});
