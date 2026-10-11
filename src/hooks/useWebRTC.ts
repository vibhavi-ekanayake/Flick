'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import {
  Peer,
  FileTransfer,
  FileMetadata,
  PendingSend,
  IncomingTransferRequest,
  WebRTCMessageHeader,
  WebRTCMessageComplete,
} from '../types';
import { detectDevice } from '../utils/device';

// Optimal WebRTC DataChannel chunk size (64 KB)
const CHUNK_SIZE = 64 * 1024;

// Flow control: Maximum buffer backlog before pausing chunk transmission (1 MB)
const MAX_BUFFERED_AMOUNT = 1024 * 1024;

// Flow control: Resumption threshold for onbufferedamountlow (256 KB)
const BUFFER_LOW_THRESHOLD = 256 * 1024;

const ICE_SERVERS: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
};

export function useWebRTC() {
  // Local device profile
  const [myProfile, setMyProfile] = useState<Peer>({
    id: '',
    deviceId: '',
    name: 'Flick Node',
    deviceType: 'desktop',
    os: 'unknown',
    color: '#0A84FF',
    joinedAt: Date.now(),
  });

  // Discovered peer nodes on LAN
  const [peers, setPeers] = useState<Peer[]>([]);

  // Active / recent file transfers
  const [transfers, setTransfers] = useState<Record<string, FileTransfer>>({});

  // Pre-send undo window to prevent accidental uploads
  const [pendingSend, setPendingSend] = useState<PendingSend | null>(null);

  // Incoming transfer waiting for user acceptance
  const [incomingRequest, setIncomingRequest] = useState<IncomingTransferRequest | null>(null);

  // Auto-accept mode toggle
  const [autoAccept, setAutoAccept] = useState<boolean>(true);

  // Socket and WebRTC connection references
  const socketRef = useRef<Socket | null>(null);
  const peerConnections = useRef<Map<string, RTCPeerConnection>>(new Map());
  const dataChannels = useRef<Map<string, RTCDataChannel>>(new Map());
  const pendingIceCandidates = useRef<Map<string, RTCIceCandidateInit[]>>(new Map());

  // Cancellation tracking
  const cancelledTransfers = useRef<Set<string>>(new Set());
  const pendingTimerRef = useRef<NodeJS.Timeout | null>(null);

  // In-flight received chunk buffers: Map<fileId, { meta: FileMetadata, chunks: ArrayBuffer[], receivedBytes: number }>
  const incomingBuffers = useRef<Map<string, { meta: FileMetadata; chunks: ArrayBuffer[]; receivedBytes: number }>>(
    new Map()
  );

  // Transfer speed calculation tracking
  const speedTrackers = useRef<Map<string, { lastBytes: number; lastTime: number }>>(new Map());

  // ---------------------------------------------------------------------------
  // 1. Helper: Manage Transfers State
  // ---------------------------------------------------------------------------
  const updateTransfer = useCallback((id: string, updates: Partial<FileTransfer>) => {
    setTransfers((prev) => {
      const existing = prev[id];
      if (!existing && !updates.fileName) return prev;
      return {
        ...prev,
        [id]: {
          ...(existing || {
            id,
            fileName: 'Transfer',
            fileSize: 0,
            fileType: '',
            peerId: '',
            peerName: '',
            direction: 'sending',
            status: 'pending',
            progress: 0,
            bytesTransferred: 0,
            speedBytesPerSec: 0,
            timeRemainingSec: null,
            startedAt: Date.now(),
          }),
          ...updates,
        },
      };
    });
  }, []);

  // ---------------------------------------------------------------------------
  // 2. WebRTC Peer Connection Lifecycle
  // ---------------------------------------------------------------------------
  // 2. WebRTC Peer Connection Lifecycle
  // ---------------------------------------------------------------------------
  const cleanupPeerConnection = useCallback((peerId: string) => {
    const pc = peerConnections.current.get(peerId);
    if (pc) {
      try { pc.close(); } catch (e) {}
      peerConnections.current.delete(peerId);
    }
    const dc = dataChannels.current.get(peerId);
    if (dc) {
      try { dc.close(); } catch (e) {}
      dataChannels.current.delete(peerId);
    }
    pendingIceCandidates.current.delete(peerId);
  }, []);

  const getOrCreatePeerConnection = useCallback((remotePeerId: string): RTCPeerConnection => {
    let pc = peerConnections.current.get(remotePeerId);
    if (pc && pc.connectionState !== 'closed' && pc.connectionState !== 'failed') {
      return pc;
    }

    pc = new RTCPeerConnection(ICE_SERVERS);
    peerConnections.current.set(remotePeerId, pc);

    pc.onicecandidate = (event) => {
      if (event.candidate && socketRef.current) {
        socketRef.current.emit('signal-ice-candidate', {
          to: remotePeerId,
          candidate: event.candidate.toJSON ? event.candidate.toJSON() : event.candidate,
        });
      }
    };

    pc.onconnectionstatechange = () => {
      if (pc?.connectionState === 'disconnected' || pc?.connectionState === 'failed') {
        cleanupPeerConnection(remotePeerId);
      }
    };

    pc.ondatachannel = (event) => {
      const dc = event.channel;
      setupDataChannelEvents(remotePeerId, dc);
    };

    return pc;
  }, [cleanupPeerConnection]);

  // ---------------------------------------------------------------------------
  // 3. Unified Receiver Logic (Used for both WebRTC DataChannel & Local Socket Relay)
  // ---------------------------------------------------------------------------
  const handleIncomingHeader = useCallback((remotePeerId: string, meta: FileMetadata, senderName?: string) => {
    incomingBuffers.current.set(meta.fileId, {
      meta,
      chunks: [],
      receivedBytes: 0,
    });

    speedTrackers.current.set(meta.fileId, {
      lastBytes: 0,
      lastTime: performance.now(),
    });

    const sender = peers.find((p) => p.id === remotePeerId || p.deviceId === remotePeerId);

    updateTransfer(meta.fileId, {
      id: meta.fileId,
      fileName: meta.name,
      fileSize: meta.size,
      fileType: meta.type,
      peerId: remotePeerId,
      peerName: senderName || sender?.name || 'Nearby Device',
      direction: 'receiving',
      status: 'transferring',
      progress: 0,
      bytesTransferred: 0,
      speedBytesPerSec: 0,
      timeRemainingSec: null,
      startedAt: Date.now(),
    });
  }, [peers, updateTransfer]);

  const handleIncomingChunk = useCallback(async (fileId: string, rawChunk: ArrayBuffer | Blob) => {
    const buffer = incomingBuffers.current.get(fileId);
    if (!buffer) return;

    let chunk: ArrayBuffer;
    if (rawChunk instanceof Blob) {
      chunk = await rawChunk.arrayBuffer();
    } else {
      chunk = rawChunk;
    }

    buffer.chunks.push(chunk);
    buffer.receivedBytes += chunk.byteLength;

    const progress = Math.min(100, Math.round((buffer.receivedBytes / buffer.meta.size) * 100));

    const now = performance.now();
    const tracker = speedTrackers.current.get(fileId);
    let speed = 0;
    let eta: number | null = null;

    if (tracker) {
      const timeDiff = (now - tracker.lastTime) / 1000;
      if (timeDiff >= 0.3) {
        const bytesDiff = buffer.receivedBytes - tracker.lastBytes;
        speed = bytesDiff / timeDiff;
        tracker.lastBytes = buffer.receivedBytes;
        tracker.lastTime = now;

        const remainingBytes = buffer.meta.size - buffer.receivedBytes;
        eta = speed > 0 ? remainingBytes / speed : null;
      }
    }

    updateTransfer(fileId, {
      progress,
      bytesTransferred: buffer.receivedBytes,
      ...(speed > 0 ? { speedBytesPerSec: speed, timeRemainingSec: eta } : {}),
    });
  }, [updateTransfer]);

  const handleIncomingComplete = useCallback((fileId: string) => {
    const buffer = incomingBuffers.current.get(fileId);
    if (!buffer) return;

    const blob = new Blob(buffer.chunks, { type: buffer.meta.type || 'application/octet-stream' });
    const blobUrl = URL.createObjectURL(blob);

    updateTransfer(fileId, {
      status: 'completed',
      progress: 100,
      bytesTransferred: buffer.meta.size,
      speedBytesPerSec: 0,
      timeRemainingSec: 0,
      blobUrl,
      completedAt: Date.now(),
    });

    // Auto-trigger browser download
    try {
      const anchor = document.createElement('a');
      anchor.href = blobUrl;
      anchor.download = buffer.meta.name;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
    } catch (e) {
      console.warn('[Flick] Browser auto-download prevented:', e);
    }

    incomingBuffers.current.delete(fileId);
    speedTrackers.current.delete(fileId);
  }, [updateTransfer]);

  const handleIncomingCancel = useCallback((fileId: string) => {
    incomingBuffers.current.delete(fileId);
    speedTrackers.current.delete(fileId);
    updateTransfer(fileId, {
      status: 'cancelled',
      error: 'Transfer cancelled by peer',
      speedBytesPerSec: 0,
    });
  }, [updateTransfer]);

  // ---------------------------------------------------------------------------
  // 4. WebRTC Data Channel Event Handlers (Receiver Side)
  // ---------------------------------------------------------------------------
  const setupDataChannelEvents = useCallback(
    (remotePeerId: string, channel: RTCDataChannel) => {
      channel.binaryType = 'arraybuffer';
      dataChannels.current.set(remotePeerId, channel);

      let currentFileMeta: FileMetadata | null = null;

      channel.onmessage = async (event) => {
        if (typeof event.data === 'string') {
          try {
            const message = JSON.parse(event.data);

            if (message.type === 'header') {
              const meta: FileMetadata = message.fileMeta;
              currentFileMeta = meta;
              handleIncomingHeader(remotePeerId, meta);
            } else if (message.type === 'complete') {
              handleIncomingComplete(message.fileId);
            } else if (message.type === 'cancel') {
              handleIncomingCancel(message.fileId);
            }
          } catch (err) {
            console.error('Failed to parse DataChannel message:', err);
          }
        } else if (event.data instanceof ArrayBuffer || event.data instanceof Blob) {
          if (currentFileMeta) {
            await handleIncomingChunk(currentFileMeta.fileId, event.data);
          }
        }
      };
    },
    [handleIncomingHeader, handleIncomingChunk, handleIncomingComplete, handleIncomingCancel]
  );

  // ---------------------------------------------------------------------------
  // 5. Dual-Engine File Transmission (WebRTC with Guaranteed Local Socket.io Relay Fallback)
  // ---------------------------------------------------------------------------
  const sendFileToPeer = useCallback(
    async (file: File, targetPeerId: string, existingFileId?: string) => {
      const fileId = existingFileId || `file-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
      const targetPeer = peers.find((p) => p.id === targetPeerId);

      // Check if cancelled before starting
      if (cancelledTransfers.current.has(fileId)) {
        cancelledTransfers.current.delete(fileId);
        return;
      }

      const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
      const fileMeta: FileMetadata = {
        fileId,
        name: file.name,
        size: file.size,
        type: file.type,
        totalChunks,
        chunkSize: CHUNK_SIZE,
      };

      updateTransfer(fileId, {
        id: fileId,
        fileName: file.name,
        fileSize: file.size,
        fileType: file.type,
        peerId: targetPeerId,
        peerName: targetPeer?.name || 'Nearby Device',
        direction: 'sending',
        status: 'transferring',
        progress: 0,
        bytesTransferred: 0,
        speedBytesPerSec: 0,
        timeRemainingSec: null,
        startedAt: Date.now(),
      });

      // Step A: Attempt direct WebRTC DataChannel connection with rapid 2.5s fallback
      let channel = dataChannels.current.get(targetPeerId);
      let useWebRTC = false;

      if (channel && channel.readyState === 'open') {
        useWebRTC = true;
      } else {
        try {
          const pc = getOrCreatePeerConnection(targetPeerId);
          const dc = pc.createDataChannel('flick-transfer', { ordered: true });
          setupDataChannelEvents(targetPeerId, dc);

          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);

          socketRef.current?.emit('signal-offer', {
            to: targetPeerId,
            offer,
          });

          await new Promise<void>((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error('WebRTC negotiation timeout')), 2500);
            dc.onopen = () => {
              clearTimeout(timeout);
              resolve();
            };
            dc.onerror = (e) => {
              clearTimeout(timeout);
              reject(e);
            };
          });

          if (dc.readyState === 'open') {
            channel = dc;
            useWebRTC = true;
          }
        } catch (err) {
          console.log('[Flick Transfer Engine] WebRTC direct P2P unavailable (NAT/AP isolation), using local Wi-Fi relay:', err);
          useWebRTC = false;
        }
      }

      if (cancelledTransfers.current.has(fileId)) {
        cancelledTransfers.current.delete(fileId);
        return;
      }

      // Step B: Send Header
      if (useWebRTC && channel && channel.readyState === 'open') {
        const headerPayload: WebRTCMessageHeader = { type: 'header', fileMeta };
        channel.send(JSON.stringify(headerPayload));
        channel.bufferedAmountLowThreshold = BUFFER_LOW_THRESHOLD;
      } else {
        socketRef.current?.emit('relay-start', {
          to: targetPeerId,
          fileMeta,
        });
      }

      let offset = 0;
      let sentBytes = 0;
      let lastSpeedCalcTime = performance.now();
      let lastSentBytes = 0;

      // Step C: Stream File Chunks
      while (offset < file.size) {
        if (cancelledTransfers.current.has(fileId)) {
          if (useWebRTC && channel && channel.readyState === 'open') {
            try { channel.send(JSON.stringify({ type: 'cancel', fileId })); } catch (e) {}
          } else {
            socketRef.current?.emit('relay-cancel', { to: targetPeerId, fileId });
          }
          updateTransfer(fileId, {
            status: 'cancelled',
            error: 'Cancelled by user',
            speedBytesPerSec: 0,
          });
          cancelledTransfers.current.delete(fileId);
          return;
        }

        const slice = file.slice(offset, offset + CHUNK_SIZE);
        const arrayBuffer = await slice.arrayBuffer();

        if (useWebRTC && channel && channel.readyState === 'open') {
          // Flow control backpressure for WebRTC DataChannel
          if (channel.bufferedAmount > MAX_BUFFERED_AMOUNT) {
            await new Promise<void>((resolve) => {
              const onLow = () => {
                channel!.removeEventListener('bufferedamountlow', onLow);
                resolve();
              };
              channel!.addEventListener('bufferedamountlow', onLow);
            });
          }
          channel.send(arrayBuffer);
        } else {
          // Local Socket.io Wi-Fi stream
          socketRef.current?.emit('relay-chunk', {
            to: targetPeerId,
            fileId,
            chunk: arrayBuffer,
            index: Math.floor(offset / CHUNK_SIZE),
            totalChunks,
          });
          // Micro yield to let socket flush smoothly
          await new Promise((r) => setTimeout(r, 4));
        }

        offset += slice.size;
        sentBytes += slice.size;

        const progress = Math.min(100, Math.round((sentBytes / file.size) * 100));
        const now = performance.now();
        const timeDiff = (now - lastSpeedCalcTime) / 1000;
        let speed = 0;
        let eta: number | null = null;

        if (timeDiff >= 0.3) {
          speed = (sentBytes - lastSentBytes) / timeDiff;
          lastSentBytes = sentBytes;
          lastSpeedCalcTime = now;

          const remainingBytes = file.size - sentBytes;
          eta = speed > 0 ? remainingBytes / speed : null;
        }

        updateTransfer(fileId, {
          progress,
          bytesTransferred: sentBytes,
          ...(speed > 0 ? { speedBytesPerSec: speed, timeRemainingSec: eta } : {}),
        });
      }

      if (cancelledTransfers.current.has(fileId)) {
        if (useWebRTC && channel && channel.readyState === 'open') {
          try { channel.send(JSON.stringify({ type: 'cancel', fileId })); } catch (e) {}
        } else {
          socketRef.current?.emit('relay-cancel', { to: targetPeerId, fileId });
        }
        cancelledTransfers.current.delete(fileId);
        return;
      }

      // Step D: Send Complete
      if (useWebRTC && channel && channel.readyState === 'open') {
        const completePayload: WebRTCMessageComplete = { type: 'complete', fileId };
        channel.send(JSON.stringify(completePayload));
      } else {
        socketRef.current?.emit('relay-complete', { to: targetPeerId, fileId });
      }

      updateTransfer(fileId, {
        status: 'completed',
        progress: 100,
        bytesTransferred: file.size,
        speedBytesPerSec: 0,
        timeRemainingSec: 0,
        completedAt: Date.now(),
      });
    },
    [getOrCreatePeerConnection, peers, setupDataChannelEvents, updateTransfer]
  );

  // ---------------------------------------------------------------------------
  // 5. User-Initiated Transfer with 3-Second Undo / Cancel Grace Window
  // ---------------------------------------------------------------------------
  const initiateTransfer = useCallback(
    (file: File, targetPeerId: string) => {
      const targetPeer = peers.find((p) => p.id === targetPeerId);
      const fileId = `file-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;

      // Clear any existing pending timer
      if (pendingTimerRef.current) {
        clearInterval(pendingTimerRef.current);
      }

      // Register transfer in state
      updateTransfer(fileId, {
        id: fileId,
        fileName: file.name,
        fileSize: file.size,
        fileType: file.type,
        peerId: targetPeerId,
        peerName: targetPeer?.name || 'Remote Peer',
        direction: 'sending',
        status: 'pending',
        progress: 0,
        bytesTransferred: 0,
        speedBytesPerSec: 0,
        timeRemainingSec: null,
        startedAt: Date.now(),
      });

      // 3-second grace countdown
      let remaining = 3;
      setPendingSend({
        file,
        targetPeerId,
        targetPeerName: targetPeer?.name || 'Remote Peer',
        fileId,
        countdown: remaining,
      });

      pendingTimerRef.current = setInterval(() => {
        remaining -= 1;
        if (remaining <= 0) {
          if (pendingTimerRef.current) {
            clearInterval(pendingTimerRef.current);
            pendingTimerRef.current = null;
          }
          setPendingSend(null);
          // Start actual send if user did not cancel
          if (!cancelledTransfers.current.has(fileId)) {
            sendFileToPeer(file, targetPeerId, fileId);
          }
        } else {
          setPendingSend((prev) => (prev && prev.fileId === fileId ? { ...prev, countdown: remaining } : prev));
        }
      }, 1000);
    },
    [peers, sendFileToPeer, updateTransfer]
  );

  // ---------------------------------------------------------------------------
  // 6. Cancel Transfer Action (Works before and during send)
  // ---------------------------------------------------------------------------
  const cancelTransfer = useCallback(
    (fileId: string) => {
      cancelledTransfers.current.add(fileId);

      // Cancel pending grace countdown if active
      if (pendingTimerRef.current) {
        clearInterval(pendingTimerRef.current);
        pendingTimerRef.current = null;
      }
      setPendingSend((prev) => (prev?.fileId === fileId ? null : prev));

      // If active peer connection exists, notify peer
      const currentTransfers = transfers;
      const transfer = currentTransfers[fileId];
      if (transfer && transfer.peerId) {
        const channel = dataChannels.current.get(transfer.peerId);
        if (channel && channel.readyState === 'open') {
          try {
            channel.send(JSON.stringify({ type: 'cancel', fileId }));
          } catch (e) {}
        }
        socketRef.current?.emit('transfer-cancel', { to: transfer.peerId, fileId });
      }

      updateTransfer(fileId, {
        status: 'cancelled',
        error: 'Cancelled by user',
        speedBytesPerSec: 0,
      });
    },
    [transfers, updateTransfer]
  );

  // Send immediately (skip 3s grace countdown)
  const confirmSendNow = useCallback(
    (fileId: string) => {
      if (pendingSend && pendingSend.fileId === fileId) {
        if (pendingTimerRef.current) {
          clearInterval(pendingTimerRef.current);
          pendingTimerRef.current = null;
        }
        const { file, targetPeerId } = pendingSend;
        setPendingSend(null);
        sendFileToPeer(file, targetPeerId, fileId);
      }
    },
    [pendingSend, sendFileToPeer]
  );

  // ---------------------------------------------------------------------------
  // 7. Incoming Dialog Actions
  // ---------------------------------------------------------------------------
  const acceptIncomingTransfer = useCallback(() => {
    if (incomingRequest && socketRef.current) {
      socketRef.current.emit('transfer-response', {
        to: incomingRequest.from,
        accepted: true,
        fileId: incomingRequest.fileMeta.fileId,
      });
      setIncomingRequest(null);
    }
  }, [incomingRequest]);

  const declineIncomingTransfer = useCallback(() => {
    if (incomingRequest && socketRef.current) {
      socketRef.current.emit('transfer-response', {
        to: incomingRequest.from,
        accepted: false,
        fileId: incomingRequest.fileMeta.fileId,
      });
      setIncomingRequest(null);
    }
  }, [incomingRequest]);

  // ---------------------------------------------------------------------------
  // 8. Update Device Nickname
  // ---------------------------------------------------------------------------
  const updateDeviceName = useCallback((newName: string) => {
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem('flick_device_name', newName);
      } catch (e) {}
    }
    setMyProfile((prev) => {
      const updated = { ...prev, name: newName };
      socketRef.current?.emit('update-profile', { name: newName });
      return updated;
    });
  }, []);


  // ---------------------------------------------------------------------------
  // 9. Socket.io Connection & Signaling Initialization
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const detected = detectDevice();
    const initialProfile: Peer = {
      id: '',
      deviceId: detected.deviceId,
      name: detected.defaultName,
      deviceType: detected.deviceType,
      os: detected.os,
      color: detected.color,
      joinedAt: Date.now(),
    };
    setMyProfile(initialProfile);

    const signalingUrl = process.env.NEXT_PUBLIC_SIGNALING_URL || undefined;
    const socket = io(signalingUrl, {
      transports: ['websocket', 'polling'],
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      const updatedProfile: Peer = { ...initialProfile, id: socket.id || '' };
      setMyProfile(updatedProfile);
      socket.emit('join', updatedProfile);
    });

    // Multi-tab filter: NEVER display other tabs from the same physical device on the radar
    socket.on('peers-list', (peerList: Peer[]) => {
      setPeers(peerList.filter((p) => p.deviceId !== detected.deviceId));
    });

    socket.on('peer-joined', (newPeer: Peer) => {
      if (newPeer.deviceId === detected.deviceId) return;
      setPeers((prev) => {
        if (prev.some((p) => p.id === newPeer.id || (newPeer.deviceId && p.deviceId === newPeer.deviceId))) {
          return prev.map((p) => (p.deviceId === newPeer.deviceId ? newPeer : p));
        }
        return [...prev, newPeer];
      });
    });

    socket.on('peer-updated', (updatedPeer: Peer) => {
      if (updatedPeer.deviceId === detected.deviceId) return;
      setPeers((prev) => prev.map((p) => (p.id === updatedPeer.id || p.deviceId === updatedPeer.deviceId ? updatedPeer : p)));
    });

    socket.on('peer-left', ({ id, deviceId }: { id: string; deviceId?: string }) => {
      setPeers((prev) => prev.filter((p) => p.id !== id && (!deviceId || p.deviceId !== deviceId)));
      cleanupPeerConnection(id);
    });

    // WebRTC Signaling
    socket.on('signal-offer', async ({ from, offer }) => {
      try {
        const pc = getOrCreatePeerConnection(from);
        await pc.setRemoteDescription(new RTCSessionDescription(offer));

        const queuedCandidates = pendingIceCandidates.current.get(from) || [];
        for (const candidate of queuedCandidates) {
          try {
            await pc.addIceCandidate(candidate).catch((e) => console.warn('ICE add error:', e));
          } catch (e) {}
        }
        pendingIceCandidates.current.delete(from);

        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);

        socket.emit('signal-answer', {
          to: from,
          answer,
        });
      } catch (err) {
        console.warn('Error handling WebRTC offer:', err);
      }
    });

    socket.on('signal-answer', async ({ from, answer }) => {
      try {
        const pc = peerConnections.current.get(from);
        if (pc) {
          await pc.setRemoteDescription(new RTCSessionDescription(answer));

          const queuedCandidates = pendingIceCandidates.current.get(from) || [];
          for (const candidate of queuedCandidates) {
            try {
              await pc.addIceCandidate(candidate).catch((e) => console.warn('ICE add error:', e));
            } catch (e) {}
          }
          pendingIceCandidates.current.delete(from);
        }
      } catch (err) {
        console.warn('Error handling WebRTC answer:', err);
      }
    });

    socket.on('signal-ice-candidate', async ({ from, candidate }) => {
      try {
        const pc = peerConnections.current.get(from);
        if (pc && pc.remoteDescription && pc.remoteDescription.type && candidate) {
          await pc.addIceCandidate(candidate).catch((e) => console.warn('ICE add error:', e));
        } else if (candidate) {
          const existing = pendingIceCandidates.current.get(from) || [];
          existing.push(candidate);
          pendingIceCandidates.current.set(from, existing);
        }
      } catch (err) {
        console.warn('Error handling ICE candidate:', err);
      }
    });

    // Local Socket.io Wi-Fi Relay Handlers (Guaranteed 100% Reliable Receiving)
    socket.on('relay-start', ({ from, senderPeer, fileMeta }) => {
      handleIncomingHeader(from, fileMeta, senderPeer?.name);
    });

    socket.on('relay-chunk', async ({ fileId, chunk }) => {
      await handleIncomingChunk(fileId, chunk);
    });

    socket.on('relay-complete', ({ fileId }) => {
      handleIncomingComplete(fileId);
    });

    socket.on('relay-cancel', ({ fileId }) => {
      handleIncomingCancel(fileId);
    });

    socket.on('transfer-cancel', ({ fileId }: { fileId: string }) => {
      handleIncomingCancel(fileId);
    });

    return () => {
      socket.disconnect();
      peerConnections.current.forEach((pc) => {
        try { pc.close(); } catch (e) {}
      });
      peerConnections.current.clear();
      dataChannels.current.clear();
    };
  }, [
    cleanupPeerConnection,
    getOrCreatePeerConnection,
    handleIncomingHeader,
    handleIncomingChunk,
    handleIncomingComplete,
    handleIncomingCancel,
  ]);

  // Derived states
  const activeTransfer = Object.values(transfers).find(
    (t) => t.status === 'transferring'
  ) || null;

  const recentCompletedTransfer = Object.values(transfers).find(
    (t) => t.status === 'completed' && t.completedAt && Date.now() - t.completedAt < 6000
  ) || null;

  const recentCancelledTransfer = Object.values(transfers).find(
    (t) => t.status === 'cancelled' && Date.now() - t.startedAt < 4000
  ) || null;

  return {
    myProfile,
    peers,
    transfers,
    pendingSend,
    activeTransfer,
    recentCompletedTransfer,
    recentCancelledTransfer,
    incomingRequest,
    autoAccept,
    setAutoAccept,
    initiateTransfer,
    cancelTransfer,
    confirmSendNow,
    acceptIncomingTransfer,
    declineIncomingTransfer,
    updateDeviceName,
  };
}
