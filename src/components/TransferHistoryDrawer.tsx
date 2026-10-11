'use client';

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { FileTransfer } from '../types';
import { formatBytes } from '../utils/format';
import { 
  FolderDown, 
  ArrowUpRight, 
  ArrowDownLeft, 
  Check, 
  X, 
  Download, 
  History
} from 'lucide-react';

interface TransferHistoryDrawerProps {
  transfers: Record<string, FileTransfer>;
  onCancelTransfer?: (transferId: string) => void;
}

export const TransferHistoryDrawer: React.FC<TransferHistoryDrawerProps> = ({ 
  transfers,
  onCancelTransfer 
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const transferList = Object.values(transfers).reverse();

  return (
    <div className="fixed bottom-6 right-6 z-40 pointer-events-auto">
      {/* Trigger Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="glass-pill px-4 py-2.5 rounded-full flex items-center gap-2 text-xs font-semibold text-white/90 shadow-lg hover:border-white/30"
      >
        <History className="w-4 h-4 text-cyan-400" />
        <span>Transfers</span>
        {transferList.length > 0 && (
          <span className="w-5 h-5 rounded-full bg-cyan-400/20 text-cyan-300 text-[10px] flex items-center justify-center font-mono">
            {transferList.length}
          </span>
        )}
      </button>

      {/* Drawer Overlay */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: 15, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 15, scale: 0.95 }}
            className="absolute bottom-12 right-0 w-80 sm:w-96 glass-card p-4 rounded-3xl shadow-2xl border border-white/15 max-h-[420px] flex flex-col"
          >
            <div className="flex items-center justify-between pb-3 border-b border-white/10 mb-2">
              <span className="text-xs font-bold text-white tracking-wide">Transfers</span>
              <button
                onClick={() => setIsOpen(false)}
                className="p-1 rounded-full text-white/40 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {transferList.length === 0 ? (
              <div className="py-8 flex flex-col items-center justify-center text-center text-xs text-white/40">
                <FolderDown className="w-8 h-8 text-white/20 mb-2" />
                <p>No transfers yet</p>
                <p className="text-[10px] text-white/25 mt-0.5">Drop files onto radar nodes</p>
              </div>
            ) : (
              <div className="overflow-y-auto space-y-2 pr-1 custom-scroll">
                {transferList.map((t) => (
                  <div
                    key={t.id}
                    className="glass-pill p-3 rounded-2xl flex items-center justify-between gap-3 text-xs"
                  >
                    <div className="flex items-center gap-2.5 truncate">
                      <div className="w-7 h-7 rounded-xl bg-white/10 flex items-center justify-center shrink-0">
                        {t.direction === 'sending' ? (
                          <ArrowUpRight className="w-3.5 h-3.5 text-blue-400" />
                        ) : (
                          <ArrowDownLeft className="w-3.5 h-3.5 text-emerald-400" />
                        )}
                      </div>
                      <div className="truncate">
                        <p className="font-semibold text-white truncate text-[12px]">{t.fileName}</p>
                        <p className="text-[10px] text-white/40">
                          {formatBytes(t.fileSize)} • {t.peerName}
                        </p>
                      </div>
                    </div>

                    {/* Actions & Status */}
                    <div className="flex items-center gap-2 shrink-0">
                      {t.status === 'completed' && t.blobUrl && (
                        <a
                          href={t.blobUrl}
                          download={t.fileName}
                          className="p-1.5 rounded-lg bg-cyan-400/10 text-cyan-300 hover:bg-cyan-400/20 transition"
                          title="Download file"
                        >
                          <Download className="w-3.5 h-3.5" />
                        </a>
                      )}
                      {t.status === 'completed' && !t.blobUrl && (
                        <span className="text-emerald-400 text-[10px] font-semibold flex items-center gap-1">
                          <Check className="w-3 h-3" /> Done
                        </span>
                      )}
                      {(t.status === 'transferring' || t.status === 'pending') && (
                        <div className="flex items-center gap-1.5">
                          <span className="text-cyan-400 text-[10px] font-semibold font-mono">
                            {t.progress}%
                          </span>
                          {onCancelTransfer && (
                            <button
                              onClick={() => onCancelTransfer(t.id)}
                              className="p-1 rounded-md text-rose-400 hover:bg-rose-500/20 transition"
                              title="Cancel transfer"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      )}
                      {t.status === 'cancelled' && (
                        <span className="text-rose-400 text-[10px]">Cancelled</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
