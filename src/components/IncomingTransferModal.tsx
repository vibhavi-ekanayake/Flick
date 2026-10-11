'use client';

import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { IncomingTransferRequest } from '../types';
import { formatBytes } from '../utils/format';
import { FileDown, X, Check, Laptop, Smartphone } from 'lucide-react';

interface IncomingTransferModalProps {
  request: IncomingTransferRequest | null;
  onAccept: () => void;
  onDecline: () => void;
}

export const IncomingTransferModal: React.FC<IncomingTransferModalProps> = ({
  request,
  onAccept,
  onDecline,
}) => {
  if (!request) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xl">
        <motion.div
          initial={{ scale: 0.85, opacity: 0, y: 20 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.85, opacity: 0, y: 20 }}
          transition={{ type: 'spring', stiffness: 400, damping: 28 }}
          className="glass-card max-w-sm w-full p-6 rounded-[32px] flex flex-col items-center text-center shadow-2xl border border-white/20 relative"
        >
          {/* Glowing sender badge */}
          <div
            className="w-16 h-16 rounded-full flex items-center justify-center mb-4 shadow-node-glow"
            style={{
              backgroundColor: request.senderPeer.color || '#0A84FF',
            }}
          >
            {request.senderPeer.deviceType === 'mobile' ? (
              <Smartphone className="w-8 h-8 text-white" />
            ) : (
              <Laptop className="w-8 h-8 text-white" />
            )}
          </div>

          <h3 className="text-base font-bold text-white mb-0.5">
            Incoming File Request
          </h3>
          <p className="text-xs text-white/60 mb-5">
            <span className="text-white font-medium">{request.senderPeer.name}</span> wants to share a file with you over the local network.
          </p>

          {/* File Card info */}
          <div className="w-full glass-pill p-3.5 rounded-2xl flex items-center gap-3 mb-6 border border-white/10">
            <div className="w-9 h-9 rounded-xl bg-white/10 flex items-center justify-center text-cyan-400 shrink-0">
              <FileDown className="w-5 h-5" />
            </div>
            <div className="text-left truncate">
              <p className="text-xs font-semibold text-white truncate">{request.fileMeta.name}</p>
              <p className="text-[11px] text-white/50">{formatBytes(request.fileMeta.size)}</p>
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-3 w-full">
            <button
              onClick={onDecline}
              className="flex-1 py-3 rounded-2xl text-xs font-semibold text-white/70 bg-white/5 hover:bg-white/10 hover:text-white border border-white/10 transition flex items-center justify-center gap-1.5"
            >
              <X className="w-4 h-4" />
              <span>Decline</span>
            </button>

            <button
              onClick={onAccept}
              className="flex-1 py-3 rounded-2xl text-xs font-semibold text-black bg-cyan-400 hover:bg-cyan-300 shadow-[0_0_20px_rgba(50,215,75,0.4)] transition flex items-center justify-center gap-1.5"
            >
              <Check className="w-4 h-4 stroke-[2.5]" />
              <span>Accept</span>
            </button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};
