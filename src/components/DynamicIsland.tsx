'use client';

import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { FileTransfer, PendingSend } from '../types';
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
  X,
  Ban
} from 'lucide-react';

interface DynamicIslandProps {
  pendingSend?: PendingSend | null;
  activeTransfer: FileTransfer | null;
  recentCompleted: FileTransfer | null;
  recentCancelled?: FileTransfer | null;
  peerCount: number;
  onCancelTransfer?: (transferId: string) => void;
  onConfirmSendNow?: (transferId: string) => void;
}

export const DynamicIsland: React.FC<DynamicIslandProps> = ({
  pendingSend,
  activeTransfer,
  recentCompleted,
  recentCancelled,
  peerCount,
  onCancelTransfer,
  onConfirmSendNow,
}) => {
  const getFileIcon = (fileType: string, fileName: string) => {
    if (fileType.startsWith('image/')) return <ImageIcon className="w-4 h-4 text-pink-400" />;
    if (fileType.startsWith('video/')) return <Film className="w-4 h-4 text-purple-400" />;
    if (fileType.startsWith('audio/')) return <Music className="w-4 h-4 text-amber-400" />;
    if (fileName.endsWith('.zip') || fileName.endsWith('.tar')) return <Archive className="w-4 h-4 text-yellow-400" />;
    return <FileText className="w-4 h-4 text-cyan-400" />;
  };

  // Circular progress ring calculation
  const radius = 18;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = activeTransfer
    ? circumference - (activeTransfer.progress / 100) * circumference
    : circumference;

  return (
    <div className="fixed top-5 left-1/2 -translate-x-1/2 z-50 pointer-events-auto flex flex-col items-center">
      <AnimatePresence mode="wait">
        {/* State 1: Pre-Send Undo Window (Prevents mistaken uploads) */}
        {pendingSend ? (
          <motion.div
            key="pending-send"
            layoutId="dynamic-island"
            initial={{ scale: 0.9, opacity: 0, y: -10 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.9, opacity: 0, y: -10 }}
            transition={{ type: 'spring', stiffness: 420, damping: 30 }}
            className="glass-island px-5 py-3 rounded-[32px] w-[350px] sm:w-[410px] flex items-center justify-between shadow-island-glow border border-amber-500/25"
          >
            <div className="flex items-center gap-2.5 truncate max-w-[210px]">
              <div className="w-8 h-8 rounded-full bg-amber-500/15 text-amber-300 flex items-center justify-center shrink-0">
                <FileText className="w-4 h-4" />
              </div>
              <div className="truncate">
                <p className="font-semibold text-white truncate text-xs">{pendingSend.file.name}</p>
                <p className="text-[11px] text-amber-300/80">
                  Sending to {pendingSend.targetPeerName} in {pendingSend.countdown}s
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              {onCancelTransfer && (
                <button
                  onClick={() => onCancelTransfer(pendingSend.fileId)}
                  className="px-3 py-1.5 rounded-full bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/35 text-xs font-semibold flex items-center gap-1 transition"
                  title="Cancel upload"
                >
                  <X className="w-3.5 h-3.5 stroke-[2.5]" />
                  <span>Cancel</span>
                </button>
              )}

              {onConfirmSendNow && (
                <button
                  onClick={() => onConfirmSendNow(pendingSend.fileId)}
                  className="px-2.5 py-1.5 rounded-full bg-white/10 hover:bg-white/20 text-white text-xs font-medium transition"
                  title="Send immediately without waiting"
                >
                  Send
                </button>
              )}
            </div>
          </motion.div>
        ) : activeTransfer ? (
          /* State 2: Active Transfer HUD with prominent Cancel button */
          <motion.div
            key="transferring"
            layoutId="dynamic-island"
            initial={{ scale: 0.9, opacity: 0, y: -10 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.9, opacity: 0, y: -10 }}
            transition={{ type: 'spring', stiffness: 420, damping: 30 }}
            className="glass-island px-5 py-3.5 rounded-[32px] w-[350px] sm:w-[420px] flex flex-col gap-2.5 shadow-island-glow"
          >
            {/* Top Row: File Info & Progress / Cancel */}
            <div className="flex items-center justify-between text-xs">
              <div className="flex items-center gap-2 truncate max-w-[210px]">
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

              {/* Progress Ring & Cancel Button */}
              <div className="flex items-center gap-2.5">
                <div className="relative w-9 h-9 flex items-center justify-center">
                  <svg className="w-9 h-9 -rotate-90" viewBox="0 0 44 44">
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
                    className="px-2.5 py-1 rounded-full bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 border border-rose-500/30 text-xs font-semibold flex items-center gap-1 transition"
                    title="Stop transfer"
                  >
                    <X className="w-3.5 h-3.5 stroke-[2.5]" />
                    <span>Cancel</span>
                  </button>
                )}
              </div>
            </div>

            {/* Bottom Row: Speed and ETA */}
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
        ) : recentCancelled ? (
          /* State 3: Cancelled Feedback Pill */
          <motion.div
            key="cancelled"
            layoutId="dynamic-island"
            initial={{ scale: 0.9, opacity: 0, y: -10 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.9, opacity: 0, y: -10 }}
            transition={{ type: 'spring', stiffness: 420, damping: 30 }}
            className="glass-island px-5 py-2.5 rounded-full flex items-center gap-2.5 border-rose-500/30 shadow-[0_0_30px_rgba(244,63,94,0.2)]"
          >
            <div className="w-5 h-5 rounded-full bg-rose-500/20 text-rose-400 flex items-center justify-center">
              <Ban className="w-3 h-3" />
            </div>
            <div className="text-xs">
              <span className="font-semibold text-rose-200">Transfer Cancelled</span>
              <span className="text-white/40 ml-1.5 truncate max-w-[120px] inline-block align-bottom">
                {recentCancelled.fileName}
              </span>
            </div>
          </motion.div>
        ) : recentCompleted ? (
          /* State 4: Completed Success Pill */
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
          /* State 5: Idle Minimal Pill */
          <motion.div
            key="idle"
            layoutId="dynamic-island"
            initial={{ scale: 0.9, opacity: 0, y: -10 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.9, opacity: 0, y: -10 }}
            transition={{ type: 'spring', stiffness: 420, damping: 30 }}
            className="glass-island px-4 py-2 rounded-full flex items-center gap-3 transition-all shadow-island-glow"
          >
            <div className="relative flex items-center justify-center">
              <span className="w-2.5 h-2.5 rounded-full bg-cyan-400 shadow-[0_0_12px_#32d74b]" />
              <span className="absolute w-4 h-4 rounded-full bg-cyan-400/30 animate-ping pointer-events-none" />
            </div>

            <div className="flex items-center gap-1.5 text-xs font-medium text-white/80">
              <Radio className="w-3.5 h-3.5 text-cyan-400" />
              <span>Flick</span>
              <span className="text-white/30">•</span>
              <span className="text-white/50">
                {peerCount === 0 ? 'Radar Active' : `${peerCount} Device${peerCount > 1 ? 's' : ''} Nearby`}
              </span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
