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
      {/* 1. Flick Minimal Branding */}
      <header className="fixed top-6 left-7 z-40 flex items-center gap-3 pointer-events-auto">
        <div className="w-8 h-8 rounded-xl bg-white/10 backdrop-blur-md border border-white/15 flex items-center justify-center shadow-lg">
          <div className="w-2.5 h-2.5 rounded-full bg-cyan-400 shadow-[0_0_10px_#32d74b]" />
        </div>
        <h1 className="text-lg font-bold tracking-tight text-white/95">Flick</h1>
      </header>


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
