'use client';

import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Pencil, X, Check, Laptop, Sparkles } from 'lucide-react';

interface RenameModalProps {
  isOpen: boolean;
  currentName: string;
  onClose: () => void;
  onSave: (newName: string) => void;
}

const PRESET_NAMES = ['My Laptop', 'My iPhone', 'Studio PC', 'MacBook Pro', 'Living Room'];

export const RenameModal: React.FC<RenameModalProps> = ({
  isOpen,
  currentName,
  onClose,
  onSave,
}) => {
  const [name, setName] = useState(currentName);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setName(currentName);
      setTimeout(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      }, 50);
    }
  }, [isOpen, currentName]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (name.trim()) {
      onSave(name.trim());
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/70 backdrop-blur-2xl">
        <motion.div

          initial={{ scale: 0.9, opacity: 0, y: 15 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.9, opacity: 0, y: 15 }}
          transition={{ type: 'spring', stiffness: 420, damping: 28 }}
          className="glass-card max-w-sm w-full p-6 rounded-[32px] flex flex-col shadow-2xl border border-white/20 relative"
        >
          {/* Close button */}
          <button
            onClick={onClose}
            className="absolute top-5 right-5 p-1.5 rounded-full text-white/40 hover:text-white hover:bg-white/10 transition"
          >
            <X className="w-4 h-4" />
          </button>

          {/* Icon and title */}
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-2xl bg-cyan-500/15 text-cyan-300 flex items-center justify-center border border-cyan-500/25 shadow-[0_0_20px_rgba(50,215,75,0.2)]">
              <Pencil className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white tracking-tight">Rename Device</h3>
              <p className="text-[11px] text-white/50">How others see you on the radar</p>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            {/* Input */}
            <div className="relative">
              <input
                ref={inputRef}
                type="text"
                value={name}
                maxLength={28}
                onChange={(e) => setName(e.target.value)}
                placeholder="Enter device nickname..."
                className="w-full px-4 py-3 rounded-2xl bg-white/5 border border-white/15 text-white placeholder-white/30 text-sm focus:outline-none focus:border-cyan-400 focus:ring-2 focus:ring-cyan-400/20 transition"
              />
            </div>

            {/* Quick Presets */}
            <div>
              <p className="text-[10px] uppercase font-mono tracking-wider text-white/40 mb-2">Quick Presets</p>
              <div className="flex flex-wrap gap-1.5">
                {PRESET_NAMES.map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => setName(preset)}
                    className="px-2.5 py-1 rounded-xl bg-white/5 hover:bg-white/10 text-white/70 hover:text-white text-xs border border-white/10 transition"
                  >
                    {preset}
                  </button>
                ))}
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-2.5 mt-2">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 py-2.5 rounded-2xl text-xs font-semibold text-white/60 bg-white/5 hover:bg-white/10 hover:text-white border border-white/10 transition"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!name.trim()}
                className="flex-1 py-2.5 rounded-2xl text-xs font-semibold text-black bg-cyan-400 hover:bg-cyan-300 shadow-[0_0_20px_rgba(50,215,75,0.4)] disabled:opacity-40 disabled:cursor-not-allowed transition flex items-center justify-center gap-1.5"
              >
                <Check className="w-3.5 h-3.5 stroke-[2.5]" />
                <span>Save Name</span>
              </button>
            </div>
          </form>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};
