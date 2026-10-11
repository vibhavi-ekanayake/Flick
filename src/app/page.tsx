'use client';

import React from 'react';
import { useWebRTC } from '../hooks/useWebRTC';
import { DynamicIsland } from '../components/DynamicIsland';
import { RadarScreen } from '../components/RadarScreen';
import { DropZoneOverlay } from '../components/DropZoneOverlay';
import { IncomingTransferModal } from '../components/IncomingTransferModal';
import { TransferHistoryDrawer } from '../components/TransferHistoryDrawer';
import { Sparkles, Share2 } from 'lucide-react';

export default function Home() {
  const {
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
  } = useWebRTC();

  // Handle dropping a file onto a specific peer or auto-routing
  const handleDropFiles = (file: File, targetPeerId?: string) => {
    if (targetPeerId) {
      initiateTransfer(file, targetPeerId);
    } else if (peers.length === 1) {
      initiateTransfer(file, peers[0].id);
    } else {
      // If multiple peers exist and none targeted, alert user to drop directly onto node
      alert('Please drop the file directly onto one of the glowing device nodes on the radar.');
    }
  };

  return (
    <main className="relative w-full h-screen overflow-hidden bg-[#07080b]">



      {/* 2. Top Morphing Dynamic Island (iOS 27 Pill) */}
      <DynamicIsland
        activeTransfer={activeTransfer}
        recentCompleted={recentCompletedTransfer}
        peerCount={peers.length}
        autoAccept={autoAccept}
        onToggleAutoAccept={() => setAutoAccept(!autoAccept)}
      />

      {/* 3. Central Sonar Radar & Floating Peer Nodes */}
      <RadarScreen
        myProfile={myProfile}
        peers={peers}
        onSendFile={(file, peerId) => initiateTransfer(file, peerId)}
        onEditName={updateDeviceName}
      />

      {/* 4. Full Window Drag & Drop Overlay */}
      <DropZoneOverlay
        peers={peers}
        onDropFiles={handleDropFiles}
      />

      {/* 5. Incoming File Transfer Approval Sheet */}
      <IncomingTransferModal
        request={incomingRequest}
        onAccept={acceptIncomingTransfer}
        onDecline={declineIncomingTransfer}
      />

      {/* 6. Transfer History & Downloads Drawer */}
      <TransferHistoryDrawer transfers={transfers} />
    </main>
  );
}
