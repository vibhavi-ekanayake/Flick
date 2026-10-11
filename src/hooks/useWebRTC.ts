'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import {
  Peer,
  FileTransfer,
  FileMetadata,
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

  // Incoming transfer waiting for user acceptance
  const [incomingRequest, setIncomingRequest] = useState<IncomingTransferRequest | null>(null);

  // Auto-accept mode toggle (AirDrop-style for trusted networks)
  const [autoAccept, setAutoAccept] = useState<boolean>(true);

  // Socket and WebRTC connection references
  const socketRef = useRef<Socket | null>(null);
  const peerConnections = useRef<Map<string, RTCPeerConnection>>(new Map());
  const dataChannels = useRef<Map<string, RTCDataChannel>>(new Map());
  const pendingIceCandidates = useRef<Map<string, RTCIceCandidateInit[]>>(new Map());

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

    // Send local ICE candidates to remote peer via signaling socket
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

    // When remote peer creates a data channel, setup receiver handlers
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
        // String message indicates control protocol (Header, Complete, Cancel)
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
                // Reassemble binary chunks into full Blob
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

                // Auto-trigger download for seamless iOS/visionOS experience
                const anchor = document.createElement('a');
                anchor.href = blobUrl;
                anchor.download = buffer.meta.name;
                document.body.appendChild(anchor);
                anchor.click();
                document.body.removeChild(anchor);

                // Clean up memory buffer
                incomingBuffers.current.delete(fileId);
                speedTrackers.current.delete(fileId);
              }
            } else if (message.type === 'cancel') {
              updateTransfer(message.fileId, {
                status: 'cancelled',
                error: 'Transfer cancelled by peer',
              });
              incomingBuffers.current.delete(message.fileId);
              speedTrackers.current.delete(message.fileId);
            }
          } catch (err) {
            console.error('Failed to parse DataChannel message:', err);
          }
        } else if (event.data instanceof ArrayBuffer && currentFileMeta) {
          // Binary chunk received
          const chunk = event.data;
          const fileId = currentFileMeta.fileId;
          const buffer = incomingBuffers.current.get(fileId);

          if (buffer) {
            buffer.chunks.push(chunk);
            buffer.receivedBytes += chunk.byteLength;

            const progress = Math.min(100, Math.round((buffer.receivedBytes / buffer.meta.size) * 100));

            // Calculate instantaneous & smoothed speed
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
  // 4. File Chunking & Backpressure Transmission (Sender Side)
  // ---------------------------------------------------------------------------
  const sendFileToPeer = useCallback(
    async (file: File, targetPeerId: string) => {
      const pc = getOrCreatePeerConnection(targetPeerId);
      const fileId = `file-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
      const targetPeer = peers.find((p) => p.id === targetPeerId);

      // Create or reuse data channel
      let channel = dataChannels.current.get(targetPeerId);
      if (!channel || channel.readyState !== 'open') {
        channel = pc.createDataChannel('antigravity-transfer', { ordered: true });
        setupDataChannelEvents(targetPeerId, channel);

        // Create WebRTC Offer
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);

        socketRef.current?.emit('signal-offer', {
          to: targetPeerId,
          offer,
        });

        // Await channel to open
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

      // Prepare metadata
      const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
      const fileMeta: FileMetadata = {
        fileId,
        name: file.name,
        size: file.size,
        type: file.type,
        totalChunks,
        chunkSize: CHUNK_SIZE,
      };

      // Set initial transfer state
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

      // Send Header packet
      const headerPayload: WebRTCMessageHeader = { type: 'header', fileMeta };
      channel.send(JSON.stringify(headerPayload));

      // Set flow control threshold
      channel.bufferedAmountLowThreshold = BUFFER_LOW_THRESHOLD;

      // Send Chunks with backpressure flow control
      let offset = 0;
      let sentBytes = 0;
      let lastSpeedCalcTime = performance.now();
      let lastSentBytes = 0;

      while (offset < file.size) {
        // Backpressure check: If buffer exceeds 1MB, wait for onbufferedamountlow event
        if (channel.bufferedAmount > MAX_BUFFERED_AMOUNT) {
          await new Promise<void>((resolve) => {
            const onLow = () => {
              channel!.removeEventListener('bufferedamountlow', onLow);
              resolve();
            };
            channel!.addEventListener('bufferedamountlow', onLow);
          });
        }

        // Slice slice and read chunk
        const slice = file.slice(offset, offset + CHUNK_SIZE);
        const arrayBuffer = await slice.arrayBuffer();

        // Transmit binary chunk
        channel.send(arrayBuffer);

        offset += slice.size;
        sentBytes += slice.size;

        const progress = Math.min(100, Math.round((sentBytes / file.size) * 100));

        // Speed metric update
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

      // Send completion packet
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
  // 5. User-Initiated Transfer Request (with accept/decline dialog)
  // ---------------------------------------------------------------------------
  const initiateTransfer = useCallback(
    (file: File, targetPeerId: string) => {
      if (autoAccept) {
        // Direct stream without manual prompt
        sendFileToPeer(file, targetPeerId);
      } else {
        // Send pre-transfer notification to receiver
        const fileMeta: FileMetadata = {
          fileId: `file-${Date.now()}`,
          name: file.name,
          size: file.size,
          type: file.type,
          totalChunks: Math.ceil(file.size / CHUNK_SIZE),
          chunkSize: CHUNK_SIZE,
        };

        socketRef.current?.emit('transfer-request', {
          to: targetPeerId,
          fileMeta,
        });

        const targetPeer = peers.find((p) => p.id === targetPeerId);
        updateTransfer(fileMeta.fileId, {
          id: fileMeta.fileId,
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

        // Store file reference for when receiver accepts
        const onResponse = (data: { from: string; accepted: boolean; fileId: string }) => {
          if (data.fileId === fileMeta.fileId) {
            socketRef.current?.off('transfer-response', onResponse);
            if (data.accepted) {
              sendFileToPeer(file, targetPeerId);
            } else {
              updateTransfer(fileMeta.fileId, {
                status: 'cancelled',
                error: 'Transfer declined by receiver',
              });
            }
          }
        };

        socketRef.current?.on('transfer-response', onResponse);
      }
    },
    [autoAccept, peers, sendFileToPeer, updateTransfer]
  );

  // ---------------------------------------------------------------------------
  // 6. Incoming Transfer Dialog Actions
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
  // 7. Update Device Nickname / Color
  // ---------------------------------------------------------------------------
  const updateDeviceName = useCallback((newName: string) => {
    setMyProfile((prev) => {
      const updated = { ...prev, name: newName };
      socketRef.current?.emit('update-profile', { name: newName });
      return updated;
    });
  }, []);

  // ---------------------------------------------------------------------------
  // 8. Socket.io Connection & Signaling Initialization
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

    // Connect to Socket.io signaling server (supports custom URL when hosted on Vercel)
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

    // Roster of other peers on LAN
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

    // Signaling: Handle incoming WebRTC Offer
    socket.on('signal-offer', async ({ from, offer }) => {
      const pc = getOrCreatePeerConnection(from);
      await pc.setRemoteDescription(new RTCSessionDescription(offer));

      // Flush any queued ICE candidates for this peer
      const queuedCandidates = pendingIceCandidates.current.get(from) || [];
      for (const candidate of queuedCandidates) {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      }
      pendingIceCandidates.current.delete(from);

      // Create and send Answer
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      socket.emit('signal-answer', {
        to: from,
        answer,
      });
    });

    // Signaling: Handle incoming WebRTC Answer
    socket.on('signal-answer', async ({ from, answer }) => {
      const pc = peerConnections.current.get(from);
      if (pc) {
        await pc.setRemoteDescription(new RTCSessionDescription(answer));

        // Flush any queued ICE candidates
        const queuedCandidates = pendingIceCandidates.current.get(from) || [];
        for (const candidate of queuedCandidates) {
          await pc.addIceCandidate(new RTCIceCandidate(candidate));
        }
        pendingIceCandidates.current.delete(from);
      }
    });

    // Signaling: Handle incoming ICE Candidate
    socket.on('signal-ice-candidate', async ({ from, candidate }) => {
      const pc = peerConnections.current.get(from);
      if (pc && pc.remoteDescription && pc.remoteDescription.type) {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      } else {
        // Queue until remote description is set
        const existing = pendingIceCandidates.current.get(from) || [];
        existing.push(candidate);
        pendingIceCandidates.current.set(from, existing);
      }
    });

    // Handle incoming transfer request prompt
    socket.on('transfer-request', (data: IncomingTransferRequest) => {
      if (autoAccept) {
        // Automatically accept
        socket.emit('transfer-response', {
          to: data.from,
          accepted: true,
          fileId: data.fileMeta.fileId,
        });
      } else {
        setIncomingRequest(data);
      }
    });

    return () => {
      socket.disconnect();
      peerConnections.current.forEach((pc) => pc.close());
      peerConnections.current.clear();
      dataChannels.current.clear();
    };
  }, [autoAccept, cleanupPeerConnection, getOrCreatePeerConnection]);

  // Active transfer calculation (first one in transferring status)
  const activeTransfer = Object.values(transfers).find(
    (t) => t.status === 'transferring' || t.status === 'pending'
  ) || null;

  const recentCompletedTransfer = Object.values(transfers).find(
    (t) => t.status === 'completed' && t.completedAt && Date.now() - t.completedAt < 8000
  ) || null;

  return {
    myProfile,
    peers,
    transfers,
    activeTransfer,
    recentCompletedTransfer,
    incomingRequest,
    autoAccept,
    setAutoAccept,
    initiateTransfer,
    acceptIncomingTransfer,
    declineIncomingTransfer,
    updateDeviceName,
  };
}
