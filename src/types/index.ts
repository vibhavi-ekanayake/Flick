export type DeviceType = 'desktop' | 'mobile' | 'tablet';

export type OS = 'macos' | 'windows' | 'ios' | 'android' | 'linux' | 'unknown';

export interface Peer {
  id: string;
  name: string;
  deviceType: DeviceType;
  os: OS;
  color: string;
  ip?: string;
  joinedAt: number;
}

export type TransferStatus = 'pending' | 'transferring' | 'completed' | 'failed' | 'cancelled';

export type TransferDirection = 'sending' | 'receiving';

export interface FileMetadata {
  fileId: string;
  name: string;
  size: number;
  type: string;
  totalChunks: number;
  chunkSize: number;
}

export interface FileTransfer {
  id: string;
  fileName: string;
  fileSize: number;
  fileType: string;
  peerId: string;
  peerName: string;
  direction: TransferDirection;
  status: TransferStatus;
  progress: number; // 0 - 100
  bytesTransferred: number;
  speedBytesPerSec: number;
  timeRemainingSec: number | null;
  blobUrl?: string;
  error?: string;
  startedAt: number;
  completedAt?: number;
}

export interface PendingSend {
  file: File;
  targetPeerId: string;
  targetPeerName: string;
  fileId: string;
  countdown: number;
}

export interface IncomingTransferRequest {
  from: string;
  senderPeer: Peer;
  fileMeta: FileMetadata;
}

export interface WebRTCMessageHeader {
  type: 'header';
  fileMeta: FileMetadata;
}

export interface WebRTCMessageComplete {
  type: 'complete';
  fileId: string;
}

export interface WebRTCMessageCancel {
  type: 'cancel';
  fileId: string;
}
