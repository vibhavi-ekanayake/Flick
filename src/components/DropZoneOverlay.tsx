'use client';

import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Peer } from '../types';
import { UploadCloud, ArrowDown, Sparkles } from 'lucide-react';

interface DropZoneOverlayProps {
  peers: Peer[];
  onDropFiles: (file: File, targetPeerId?: string) => void;
}

export const DropZoneOverlay: React.FC<DropZoneOverlayProps> = ({
  peers,
  onDropFiles,
}) => {
  const [isWindowDragging, setIsWindowDragging] = useState(false);
  const dragCounter = React.useRef(0);

  useEffect(() => {
    const handleDragEnter = (e: DragEvent) => {
      e.preventDefault();
      dragCounter.current += 1;
      if (e.dataTransfer && e.dataTransfer.types.includes('Files')) {
        setIsWindowDragging(true);
      }
    };

    const handleDragLeave = (e: DragEvent) => {
      e.preventDefault();
      dragCounter.current -= 1;
      if (dragCounter.current <= 0) {
        setIsWindowDragging(false);
        dragCounter.current = 0;
      }
    };

    const handleDragOver = (e: DragEvent) => {
      e.preventDefault();
    };

    const handleDrop = (e: DragEvent) => {
      e.preventDefault();
      dragCounter.current = 0;
      setIsWindowDragging(false);

      if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        const file = e.dataTransfer.files[0];
        // If there is exactly one peer, default to sending to that peer!
        if (peers.length === 1) {
          onDropFiles(file, peers[0].id);
        } else {
          onDropFiles(file);
        }
      }
    };

    window.addEventListener('dragenter', handleDragEnter);
    window.addEventListener('dragleave', handleDragLeave);
    window.addEventListener('dragover', handleDragOver);
    window.addEventListener('drop', handleDrop);

    return () => {
      window.removeEventListener('dragenter', handleDragEnter);
      window.removeEventListener('dragleave', handleDragLeave);
      window.removeEventListener('dragover', handleDragOver);
      window.removeEventListener('drop', handleDrop);
    };
  }, [peers, onDropFiles]);

  return (
    <AnimatePresence>
      {isWindowDragging && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 z-40 pointer-events-none flex items-center justify-center bg-black/60 backdrop-blur-md"
        >
          {/* Holographic dashed border */}
          <div className="absolute inset-8 rounded-[40px] border-2 border-dashed border-cyan-400/50 bg-cyan-500/5 flex flex-col items-center justify-center shadow-[0_0_80px_rgba(50,215,75,0.2)]">
            <motion.div
              initial={{ scale: 0.8, y: 10 }}
              animate={{ scale: 1, y: 0 }}
              className="flex flex-col items-center text-center p-8 glass-card rounded-3xl max-w-sm pointer-events-auto"
            >
              <div className="w-16 h-16 rounded-full bg-cyan-400/10 text-cyan-300 flex items-center justify-center mb-4 border border-cyan-400/30 shadow-[0_0_30px_rgba(50,215,75,0.3)]">
                <UploadCloud className="w-8 h-8 animate-bounce" />
              </div>

              <h3 className="text-lg font-bold text-white mb-1">
                Drop Directly on a Device
              </h3>
              <p className="text-xs text-white/60 mb-3">
                Hover over any glowing node to send your file directly at full local speed.
              </p>

              {peers.length === 1 && (
                <div className="flex items-center gap-1.5 text-xs text-cyan-300 bg-cyan-500/10 border border-cyan-500/20 px-3 py-1.5 rounded-full">
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>Release anywhere to send to {peers[0].name}</span>
                </div>
              )}
            </motion.div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
