'use client';

import React, { useMemo } from 'react';
import { motion } from 'framer-motion';
import { Peer } from '../types';
import { PeerNode } from './PeerNode';

interface RadarScreenProps {
  myProfile: Peer;
  peers: Peer[];
  onSendFile: (file: File, peerId: string) => void;
  onEditName: (name: string) => void;
}

export const RadarScreen: React.FC<RadarScreenProps> = ({
  myProfile,
  peers,
  onSendFile,
  onEditName,
}) => {
  // Compute orbital positions for peers around the central radar
  const peerPositions = useMemo(() => {
    const count = peers.length;
    if (count === 0) return [];

    // Radar orbital radius in pixels
    const radius = 220;

    return peers.map((peer, index) => {
      // Offset start angle so peers distribute nicely
      const angle = (2 * Math.PI * index) / count - Math.PI / 2;
      const x = Math.round(Math.cos(angle) * radius);
      const y = Math.round(Math.sin(angle) * radius);
      return { peer, position: { x, y } };
    });
  }, [peers]);

  return (
    <div className="relative w-full h-screen overflow-hidden flex items-center justify-center bg-[#07080b]">
      {/* 1. Ambient Mesh Gradient Orbs in Background */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/4 left-1/4 w-[500px] h-[500px] bg-purple-600/15 rounded-full blur-[140px] animate-orb-float" />
        <div className="absolute bottom-1/4 right-1/4 w-[450px] h-[450px] bg-blue-600/15 rounded-full blur-[140px] animate-orb-float [animation-delay:4s]" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-cyan-500/10 rounded-full blur-[160px] animate-pulse-slow" />
      </div>

      {/* 2. Concentric Radar Rings */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        {/* Ring 1 (Inner) */}
        <div className="w-[200px] h-[200px] rounded-full radar-ring animate-pulse-slow opacity-60" />
        {/* Ring 2 (Middle) */}
        <div className="absolute w-[440px] h-[440px] rounded-full radar-ring opacity-40" />
        {/* Ring 3 (Outer) */}
        <div className="absolute w-[680px] h-[680px] rounded-full radar-ring opacity-25" />
        {/* Ring 4 (Far Perimeter) */}
        <div className="absolute w-[920px] h-[920px] rounded-full radar-ring opacity-15" />

        {/* Radar Sweeping Scanner Line */}
        <div className="absolute w-[680px] h-[680px] rounded-full pointer-events-none animate-radar-sweep">
          <div className="w-1/2 h-1/2 origin-bottom-right bg-gradient-to-tl from-cyan-500/15 via-blue-500/5 to-transparent rounded-tl-full" />
        </div>
      </div>

      {/* 3. Center Node: The Current User */}
      <div className="relative z-20">
        <PeerNode
          peer={myProfile}
          isSelf={true}
          position={{ x: 0, y: 0 }}
          onEditName={onEditName}
        />
      </div>

      {/* 4. Orbiting Discovered Peers */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-auto z-30">
        {peerPositions.map(({ peer, position }) => (
          <PeerNode
            key={peer.id}
            peer={peer}
            isSelf={false}
            position={position}
            onSendFile={onSendFile}
          />
        ))}
      </div>

      {/* 5. Minimal Radar Scanning Indicator */}
      {peers.length === 0 && (
        <div className="absolute bottom-8 flex items-center gap-2 text-xs text-white/40 font-medium pointer-events-none">
          <span className="w-2 h-2 rounded-full bg-cyan-400/70 animate-pulse" />
          <span>Scanning for nearby devices...</span>
        </div>
      )}
    </div>
  );
};

