'use client';

import React, { useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Peer } from '../types';
import { 
  Laptop, 
  Smartphone, 
  Tablet, 
  Monitor, 
  UploadCloud,
  CheckCircle2,
  HardDrive
} from 'lucide-react';

interface PeerNodeProps {
  peer: Peer;
  isSelf?: boolean;
  position?: { x: number; y: number };
  onSendFile?: (file: File, peerId: string) => void;
  onEditName?: (name: string) => void;
}

export const PeerNode: React.FC<PeerNodeProps> = ({
  peer,
  isSelf = false,
  position = { x: 0, y: 0 },
  onSendFile,
  onEditName,
}) => {
  const [isDragOver, setIsDragOver] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [nameInput, setNameInput] = useState(peer.name);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Device type icon selector
  const getDeviceIcon = () => {
    switch (peer.deviceType) {
      case 'mobile':
        return <Smartphone className="w-6 h-6 text-white/90" />;
      case 'tablet':
        return <Tablet className="w-6 h-6 text-white/90" />;
      default:
        if (peer.os === 'windows') return <Monitor className="w-6 h-6 text-white/90" />;
        return <Laptop className="w-6 h-6 text-white/90" />;
    }
  };

  // Drag and drop handlers for this specific node
  const handleDragOver = (e: React.DragEvent) => {
    if (isSelf) return;
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    if (isSelf) return;
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    if (isSelf) return;
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0 && onSendFile) {
      const file = e.dataTransfer.files[0];
      onSendFile(file, peer.id);
    }
  };

  // Click-to-browse trigger
  const handleClick = () => {
    if (isSelf) {
      setIsEditing(true);
      return;
    }
    fileInputRef.current?.click();
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0 && onSendFile) {
      const file = e.target.files[0];
      onSendFile(file, peer.id);
      // Reset input value
      e.target.value = '';
    }
  };

  const handleNameSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (nameInput.trim() && onEditName) {
      onEditName(nameInput.trim());
    }
    setIsEditing(false);
  };

  return (
    <motion.div
      className="relative flex flex-col items-center justify-center select-none"
      initial={{ scale: 0, opacity: 0 }}
      animate={{
        scale: isDragOver ? 1.25 : 1,
        opacity: 1,
        x: position.x,
        y: position.y,
      }}
      transition={{
        type: 'spring',
        stiffness: 300,
        damping: 24,
      }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Hidden file input for click-to-share */}
      {!isSelf && (
        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          onChange={handleFileInputChange}
          multiple={false}
        />
      )}

      {/* Target Glow Halo when dragging file over node */}
      {isDragOver && (
        <motion.div
          className="absolute -inset-4 rounded-full border-2 border-dashed border-cyan-400 bg-cyan-400/20 shadow-node-hover pointer-events-none"
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1.15, opacity: 1 }}
          transition={{ repeat: Infinity, duration: 1.2, repeatType: 'reverse' }}
        />
      )}

      {/* Glowing Orb Backdrop */}
      <div
        className="absolute -inset-2 rounded-full opacity-60 blur-xl pointer-events-none transition-all duration-500"
        style={{
          background: `radial-gradient(circle, ${peer.color || '#0A84FF'} 0%, transparent 70%)`,
          transform: isHovered || isDragOver ? 'scale(1.4)' : 'scale(1)',
        }}
      />

      {/* The Central Orb Node */}
      <button
        onClick={handleClick}
        className={`relative z-10 w-20 h-20 sm:w-24 sm:h-24 rounded-full glass-node flex flex-col items-center justify-center cursor-pointer transition-all duration-300 ${
          isDragOver
            ? 'border-cyan-400 shadow-[0_0_40px_rgba(50,215,75,0.6)] scale-110'
            : isHovered
            ? 'border-white/40 shadow-node-hover scale-105'
            : 'border-white/15'
        }`}
        style={{
          borderColor: isDragOver ? '#32D74B' : isHovered ? peer.color : undefined,
        }}
      >
        {/* Drop indicator prompt */}
        {isDragOver ? (
          <UploadCloud className="w-8 h-8 text-cyan-300 animate-bounce" />
        ) : (
          <div className="flex flex-col items-center justify-center">
            {getDeviceIcon()}
            {isSelf && (
              <span className="text-[10px] font-bold uppercase tracking-wider text-cyan-400 mt-1">
                You
              </span>
            )}
          </div>
        )}

        {/* Pulse beacon dot */}
        <span
          className="absolute bottom-1.5 right-1.5 w-3 h-3 rounded-full border-2 border-[#07080b]"
          style={{ backgroundColor: isSelf ? '#32D74B' : '#0A84FF' }}
        />
      </button>

      {/* Device Info & Nickname */}
      <div className="relative z-10 mt-3 flex flex-col items-center text-center max-w-[150px]">
        {isEditing && isSelf ? (
          <form onSubmit={handleNameSubmit} className="flex items-center">
            <input
              type="text"
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              onBlur={handleNameSubmit}
              autoFocus
              className="bg-black/60 border border-white/30 rounded-lg px-2 py-0.5 text-xs text-center text-white focus:outline-none focus:border-cyan-400"
            />
          </form>
        ) : (
          <div className="flex flex-col items-center group">
            <span
              className="text-xs sm:text-sm font-semibold text-white/90 truncate tracking-tight hover:text-white cursor-pointer"
              title={isSelf ? 'Click to rename device' : 'Click to send file'}
            >
              {peer.name}
            </span>
            <div className="flex items-center gap-1.5 mt-0.5">
              <span className="text-[10px] uppercase font-mono tracking-wider text-white/40">
                {peer.os !== 'unknown' ? peer.os : peer.deviceType}
              </span>
            </div>
          </div>
        )}

        {/* Action Hint on Hover */}
        {!isSelf && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: isHovered ? 1 : 0, y: isHovered ? 0 : -4 }}
            className="text-[10px] font-medium text-cyan-300 mt-1 bg-white/10 px-2 py-0.5 rounded-full border border-white/10 pointer-events-none"
          >
            Drop or click
          </motion.div>
        )}
      </div>
    </motion.div>
  );
};
