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
          candidate: event.candidate,
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
  }, []);

  const cleanupPeerConnection = useCallback((peerId: string) => {
    const pc = peerConnections.current.get(peerId);
    if (pc) {
      pc.close();
      peerConnections.current.delete(peerId);
    }
    const dc = dataChannels.current.get(peerId);
    if (dc) {
      dc.close();
      dataChannels.current.delete(peerId);
    }
    pendingIceCandidates.current.delete(peerId);
  }, []);

  // ---------------------------------------------------------------------------
  // 3. WebRTC Data Channel Event Handlers (Receiver Side)
  // ---------------------------------------------------------------------------
  const setupDataChannelEvents = useCallback(
    (remotePeerId: string, channel: RTCDataChannel) => {
      channel.binaryType = 'arraybuffer';
      dataChannels.current.set(remotePeerId, channel);

      let currentFileMeta: FileMetadata | null = null;

      channel.onmessage = (event) => {
        if (typeof event.data === 'string') {
          try {
            const message = JSON.parse(event.data);

            if (message.type === 'header') {
              const meta: FileMetadata = message.fileMeta;
              currentFileMeta = meta;

              incomingBuffers.current.set(meta.fileId, {
                meta,
                chunks: [],
                receivedBytes: 0,
              });

              speedTrackers.current.set(meta.fileId, {
                lastBytes: 0,
                lastTime: performance.now(),
              });

              const sender = peers.find((p) => p.id === remotePeerId);

              updateTransfer(meta.fileId, {
                id: meta.fileId,
                fileName: meta.name,
                fileSize: meta.size,
                fileType: meta.type,
                peerId: remotePeerId,
                peerName: sender?.name || 'Remote Peer',
                direction: 'receiving',
                status: 'transferring',
                progress: 0,
                bytesTransferred: 0,
                speedBytesPerSec: 0,
                timeRemainingSec: null,
                startedAt: Date.now(),
              });
            } else if (message.type === 'complete') {
              const fileId = message.fileId;
              const buffer = incomingBuffers.current.get(fileId);

              if (buffer) {
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

                const anchor = document.createElement('a');
                anchor.href = blobUrl;
                anchor.download = buffer.meta.name;
                document.body.appendChild(anchor);
                anchor.click();
                document.body.removeChild(anchor);

                incomingBuffers.current.delete(fileId);
                speedTrackers.current.delete(fileId);
              }
            } else if (message.type === 'cancel') {
              const fileId = message.fileId;
              updateTransfer(fileId, {
                status: 'cancelled',
                error: 'Transfer cancelled by sender',
                speedBytesPerSec: 0,
              });
              incomingBuffers.current.delete(fileId);
              speedTrackers.current.delete(fileId);
            }
          } catch (err) {
            console.error('Failed to parse DataChannel message:', err);
          }
        } else if (event.data instanceof ArrayBuffer && currentFileMeta) {
          const chunk = event.data;
          const fileId = currentFileMeta.fileId;
          const buffer = incomingBuffers.current.get(fileId);

          if (buffer) {
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
          }
        }
      };
    },
    [peers, updateTransfer]
  );

  // ---------------------------------------------------------------------------
  // 4. File Chunking & Transmission (Sender Side with Cancellation Check)
  // ---------------------------------------------------------------------------
  const sendFileToPeer = useCallback(
    async (file: File, targetPeerId: string, existingFileId?: string) => {
      const pc = getOrCreatePeerConnection(targetPeerId);
      const fileId = existingFileId || `file-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
      const targetPeer = peers.find((p) => p.id === targetPeerId);

      // Check if cancelled before starting
      if (cancelledTransfers.current.has(fileId)) {
        cancelledTransfers.current.delete(fileId);
        return;
      }

      // Create or reuse data channel
      let channel = dataChannels.current.get(targetPeerId);
      if (!channel || channel.readyState !== 'open') {
        channel = pc.createDataChannel('antigravity-transfer', { ordered: true });
        setupDataChannelEvents(targetPeerId, channel);

        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);

        socketRef.current?.emit('signal-offer', {
          to: targetPeerId,
          offer,
        });

        await new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error('Connection timed out')), 15000);
          channel!.onopen = () => {
            clearTimeout(timeout);
            resolve();
          };
          channel!.onerror = (e) => {
            clearTimeout(timeout);
            reject(e);
          };
        });
      }

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
        peerName: targetPeer?.name || 'Remote Peer',
        direction: 'sending',
        status: 'transferring',
        progress: 0,
        bytesTransferred: 0,
        speedBytesPerSec: 0,
        timeRemainingSec: null,
        startedAt: Date.now(),
      });

      // Send Header
      const headerPayload: WebRTCMessageHeader = { type: 'header', fileMeta };
      channel.send(JSON.stringify(headerPayload));

      channel.bufferedAmountLowThreshold = BUFFER_LOW_THRESHOLD;

      let offset = 0;
      let sentBytes = 0;
      let lastSpeedCalcTime = performance.now();
      let lastSentBytes = 0;

      while (offset < file.size) {
        // Immediate cancellation check
        if (cancelledTransfers.current.has(fileId)) {
          try {
            channel.send(JSON.stringify({ type: 'cancel', fileId }));
          } catch (e) {}
          updateTransfer(fileId, {
            status: 'cancelled',
            error: 'Cancelled by user',
            speedBytesPerSec: 0,
          });
          cancelledTransfers.current.delete(fileId);
          return;
        }

        // Backpressure flow control
        if (channel.bufferedAmount > MAX_BUFFERED_AMOUNT) {
          await new Promise<void>((resolve) => {
            const onLow = () => {
              channel!.removeEventListener('bufferedamountlow', onLow);
              resolve();
            };
            channel!.addEventListener('bufferedamountlow', onLow);
          });
        }

        if (cancelledTransfers.current.has(fileId)) {
          try {
            channel.send(JSON.stringify({ type: 'cancel', fileId }));
          } catch (e) {}
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

        channel.send(arrayBuffer);

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
        try {
          channel.send(JSON.stringify({ type: 'cancel', fileId }));
        } catch (e) {}
        cancelledTransfers.current.delete(fileId);
        return;
      }

      // Send complete
      const completePayload: WebRTCMessageComplete = { type: 'complete', fileId };
      channel.send(JSON.stringify(completePayload));

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
      const updatedProfile = { ...initialProfile, id: socket.id || '' };
      setMyProfile(updatedProfile);
      socket.emit('join', updatedProfile);
    });

    socket.on('peers-list', (peerList: Peer[]) => {
      setPeers(peerList);
    });

    socket.on('peer-joined', (newPeer: Peer) => {
      setPeers((prev) => {
        if (prev.some((p) => p.id === newPeer.id)) return prev;
        return [...prev, newPeer];
      });
    });

    socket.on('peer-updated', (updatedPeer: Peer) => {
      setPeers((prev) => prev.map((p) => (p.id === updatedPeer.id ? updatedPeer : p)));
    });

    socket.on('peer-left', ({ id }: { id: string }) => {
      setPeers((prev) => prev.filter((p) => p.id !== id));
      cleanupPeerConnection(id);
    });

    socket.on('signal-offer', async ({ from, offer }) => {
      const pc = getOrCreatePeerConnection(from);
      await pc.setRemoteDescription(new RTCSessionDescription(offer));

      const queuedCandidates = pendingIceCandidates.current.get(from) || [];
      for (const candidate of queuedCandidates) {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      }
      pendingIceCandidates.current.delete(from);

      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      socket.emit('signal-answer', {
        to: from,
        answer,
      });
    });

    socket.on('signal-answer', async ({ from, answer }) => {
      const pc = peerConnections.current.get(from);
      if (pc) {
        await pc.setRemoteDescription(new RTCSessionDescription(answer));

        const queuedCandidates = pendingIceCandidates.current.get(from) || [];
        for (const candidate of queuedCandidates) {
          await pc.addIceCandidate(new RTCIceCandidate(candidate));
        }
        pendingIceCandidates.current.delete(from);
      }
    });

    socket.on('signal-ice-candidate', async ({ from, candidate }) => {
      const pc = peerConnections.current.get(from);
      if (pc && pc.remoteDescription && pc.remoteDescription.type) {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      } else {
        const existing = pendingIceCandidates.current.get(from) || [];
        existing.push(candidate);
        pendingIceCandidates.current.set(from, existing);
      }
    });

    socket.on('transfer-cancel', ({ fileId }: { fileId: string }) => {
      incomingBuffers.current.delete(fileId);
      speedTrackers.current.delete(fileId);
      updateTransfer(fileId, {
        status: 'cancelled',
        error: 'Transfer cancelled by peer',
        speedBytesPerSec: 0,
      });
    });

    return () => {
      socket.disconnect();
      peerConnections.current.forEach((pc) => pc.close());
      peerConnections.current.clear();
      dataChannels.current.clear();
    };
  }, [cleanupPeerConnection, getOrCreatePeerConnection, updateTransfer]);

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
