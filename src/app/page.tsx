'use client';

import React from 'react';
import { useWebRTC } from '../hooks/useWebRTC';
import { DynamicIsland } from '../components/DynamicIsland';
import { RadarScreen } from '../components/RadarScreen';
import { DropZoneOverlay } from '../components/DropZoneOverlay';
import { IncomingTransferModal } from '../components/IncomingTransferModal';
import { TransferHistoryDrawer } from '../components/TransferHistoryDrawer';

export default function Home() {
  const {
    myProfile,
    peers,
    transfers,
    pendingSend,
    activeTransfer,
    recentCompletedTransfer,
    recentCancelledTransfer,
    incomingRequest,
    initiateTransfer,
    cancelTransfer,
    confirmSendNow,
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
      alert('Please drop the file directly onto one of the glowing device nodes on the radar.');
    }
  };

  return (
    <main className="relative w-full h-screen overflow-hidden bg-[#07080b]">
      {/* 1. Morphing Dynamic Island with 3-Second Undo / Cancel Window */}
      <DynamicIsland
        pendingSend={pendingSend}
        activeTransfer={activeTransfer}
        recentCompleted={recentCompletedTransfer}
        recentCancelled={recentCancelledTransfer}
        peerCount={peers.length}
        onCancelTransfer={cancelTransfer}
        onConfirmSendNow={confirmSendNow}
      />

      {/* 2. Central Sonar Radar & Floating Peer Nodes */}
      <RadarScreen
        myProfile={myProfile}
        peers={peers}
        onSendFile={(file, peerId) => initiateTransfer(file, peerId)}
        onEditName={updateDeviceName}
      />

      {/* 3. Full Window Drag & Drop Overlay */}
      <DropZoneOverlay
        peers={peers}
        onDropFiles={handleDropFiles}
      />

      {/* 4. Incoming File Transfer Approval Sheet */}
      <IncomingTransferModal
        request={incomingRequest}
        onAccept={acceptIncomingTransfer}
        onDecline={declineIncomingTransfer}
      />

      {/* 5. Transfer History & Downloads Drawer */}
      <TransferHistoryDrawer
        transfers={transfers}
        onCancelTransfer={cancelTransfer}
      />
    </main>
  );
}
