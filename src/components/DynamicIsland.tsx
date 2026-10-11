'use client';

import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { FileTransfer } from '../types';
import { formatBytes, formatSpeed, formatTimeRemaining } from '../utils/format';
import { 
  Radio, 
  ArrowUpRight, 
  ArrowDownLeft, 
  Check, 
  FileText, 
  Film, 
  Music, 
  Image as ImageIcon,
  Archive,
  X
} from 'lucide-react';

interface DynamicIslandProps {
  activeTransfer: FileTransfer | null;
  recentCompleted: FileTransfer | null;
  peerCount: number;
  autoAccept: boolean;
  onToggleAutoAccept: () => void;
  onCancelTransfer?: (transferId: string) => void;
}

export const DynamicIsland: React.FC<DynamicIslandProps> = ({
  activeTransfer,
  recentCompleted,
  peerCount,
  autoAccept,
  onToggleAutoAccept,
  onCancelTransfer,
}) => {
  // Determine file icon based on mime type or extension
  const getFileIcon = (fileType: string, fileName: string) => {
    if (fileType.startsWith('image/')) return <ImageIcon className="w-4 h-4 text-pink-400" />;
    if (fileType.startsWith('video/')) return <Film className="w-4 h-4 text-purple-400" />;
    if (fileType.startsWith('audio/')) return <Music className="w-4 h-4 text-amber-400" />;
    if (fileName.endsWith('.zip') || fileName.endsWith('.tar')) return <Archive className="w-4 h-4 text-yellow-400" />;
    return <FileText className="w-4 h-4 text-blue-400" />;
  };

  // SVG circular progress calculation
  const radius = 18;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = activeTransfer
    ? circumference - (activeTransfer.progress / 100) * circumference
    : circumference;

  return (
    <div className="fixed top-5 left-1/2 -translate-x-1/2 z-50 pointer-events-auto flex flex-col items-center">
      <AnimatePresence mode="wait">
        {/* State 1: Active Transfer HUD */}
        {activeTransfer ? (
          <motion.div
            key="transferring"
            layoutId="dynamic-island"
            initial={{ scale: 0.9, opacity: 0, y: -10 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.9, opacity: 0, y: -10 }}
            transition={{ type: 'spring', stiffness: 420, damping: 30 }}
            className="glass-island px-5 py-3.5 rounded-[32px] w-[350px] sm:w-[420px] flex flex-col gap-2.5 shadow-island-glow"
          >
            {/* Top Row: File Meta & Direction */}
            <div className="flex items-center justify-between text-xs">
              <div className="flex items-center gap-2 truncate max-w-[240px]">
                <div className="w-7 h-7 rounded-full bg-white/10 flex items-center justify-center shrink-0">
                  {getFileIcon(activeTransfer.fileType, activeTransfer.fileName)}
                </div>
                <div className="truncate">
                  <p className="font-semibold text-white/95 truncate text-[13px]">{activeTransfer.fileName}</p>
                  <p className="text-[11px] text-white/50">
                    {formatBytes(activeTransfer.bytesTransferred)} of {formatBytes(activeTransfer.fileSize)}
                  </p>
                </div>
              </div>

              {/* Progress Ring & Cancel */}
              <div className="flex items-center gap-3">
                <div className="relative w-10 h-10 flex items-center justify-center">
                  <svg className="w-10 h-10 -rotate-90" viewBox="0 0 44 44">
                    <circle
                      cx="22"
                      cy="22"
                      r={radius}
                      className="text-white/10"
                      strokeWidth="3.5"
                      stroke="currentColor"
                      fill="transparent"
                    />
                    <circle
                      cx="22"
                      cy="22"
                      r={radius}
                      className="text-cyan-400 transition-all duration-300"
                      strokeWidth="3.5"
                      strokeDasharray={circumference}
                      strokeDashoffset={strokeDashoffset}
                      strokeLinecap="round"
                      stroke="currentColor"
                      fill="transparent"
                    />
                  </svg>
                  <span className="absolute text-[10px] font-bold text-white tracking-tighter">
                    {activeTransfer.progress}%
                  </span>
                </div>

                {onCancelTransfer && (
                  <button
                    onClick={() => onCancelTransfer(activeTransfer.id)}
                    className="p-1 rounded-full text-white/40 hover:text-white/90 hover:bg-white/10 transition"
                    title="Cancel transfer"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>

            {/* Bottom Row: Speed & ETA Bar */}
            <div className="flex items-center justify-between pt-1 border-t border-white/5 text-[11px]">
              <div className="flex items-center gap-1.5 font-medium text-cyan-300">
                {activeTransfer.direction === 'sending' ? (
                  <ArrowUpRight className="w-3.5 h-3.5 text-blue-400" />
                ) : (
                  <ArrowDownLeft className="w-3.5 h-3.5 text-emerald-400" />
                )}
                <span>
                  {activeTransfer.direction === 'sending' ? 'Sending to' : 'Receiving from'}{' '}
                  <span className="text-white font-semibold">{activeTransfer.peerName}</span>
                </span>
              </div>

              <div className="flex items-center gap-2">
                <span className="font-mono font-semibold text-white/90 bg-white/10 px-2 py-0.5 rounded-full">
                  {formatSpeed(activeTransfer.speedBytesPerSec)}
                </span>
                <span className="text-white/50">{formatTimeRemaining(activeTransfer.timeRemainingSec)}</span>
              </div>
            </div>
          </motion.div>
        ) : recentCompleted ? (
          /* State 2: Completed Success Pill */
          <motion.div
            key="completed"
            layoutId="dynamic-island"
            initial={{ scale: 0.9, opacity: 0, y: -10 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.9, opacity: 0, y: -10 }}
            transition={{ type: 'spring', stiffness: 420, damping: 30 }}
            className="glass-island px-5 py-2.5 rounded-full flex items-center gap-3 border-emerald-500/30 shadow-[0_0_30px_rgba(50,215,75,0.25)]"
          >
            <div className="w-6 h-6 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center">
              <Check className="w-3.5 h-3.5 stroke-[3]" />
            </div>
            <div className="text-xs">
              <span className="font-semibold text-white/95">Transferred {recentCompleted.fileName}</span>
              <span className="text-white/40 ml-1.5">({formatBytes(recentCompleted.fileSize)})</span>
            </div>
          </motion.div>
        ) : (
          /* State 3: Idle Compact Capsule */
          <motion.div
            key="idle"
            layoutId="dynamic-island"
            initial={{ scale: 0.9, opacity: 0, y: -10 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.9, opacity: 0, y: -10 }}
            transition={{ type: 'spring', stiffness: 420, damping: 30 }}
            className="glass-island px-4 py-2 rounded-full flex items-center gap-3 cursor-pointer group hover:border-white/25 transition-all shadow-island-glow"
            onClick={onToggleAutoAccept}
            title={`Click to toggle Auto-Accept (Currently: ${autoAccept ? 'ON' : 'OFF'})`}
          >
            {/* Pulsing Sonar Beacon */}
            <div className="relative flex items-center justify-center">
              <span className="w-2.5 h-2.5 rounded-full bg-cyan-400 shadow-[0_0_12px_#32d74b]" />
              <span className="absolute w-4 h-4 rounded-full bg-cyan-400/30 animate-ping pointer-events-none" />
            </div>

            <div className="flex items-center gap-1.5 text-xs font-medium text-white/80">
              <Radio className="w-3.5 h-3.5 text-cyan-400" />
              <span>Flick</span>
              <span className="text-white/30">•</span>
              <span className="text-white/50 group-hover:text-white/80 transition">
                {peerCount === 0 ? 'Radar Active' : `${peerCount} Device${peerCount > 1 ? 's' : ''} Nearby`}
              </span>
            </div>

            {/* Auto-Accept Mini Badge */}
            <div
              className={`text-[10px] px-2 py-0.5 rounded-full font-medium transition ${
                autoAccept
                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                  : 'bg-white/10 text-white/40'
              }`}
            >
              {autoAccept ? 'Auto-Accept' : 'Ask'}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
