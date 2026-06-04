'use client';

import React, { useCallback, useState, useRef } from 'react';
import { Upload, Music, FileAudio, AlertCircle } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';

interface DropZoneProps {
  onFileSelected: (file: File) => void;
  isProcessing: boolean;
}

const ACCEPTED_TYPES = ['audio/wav', 'audio/mpeg', 'audio/mp3', 'audio/ogg', 'audio/flac', 'audio/webm'];
const ACCEPTED_EXTENSIONS = ['.wav', '.mp3', '.ogg', '.flac', '.webm', '.m4a'];

function isValidAudioFile(file: File): boolean {
  if (ACCEPTED_TYPES.includes(file.type)) return true;
  const ext = file.name.toLowerCase().slice(file.name.lastIndexOf('.'));
  return ACCEPTED_EXTENSIONS.includes(ext);
}

export function DropZone({ onFileSelected, isProcessing }: DropZoneProps) {
  const [isDragOver, setIsDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback((file: File) => {
    setError(null);
    if (!isValidAudioFile(file)) {
      setError('Unsupported file format. Please use WAV, MP3, OGG, FLAC, or WebM.');
      return;
    }
    if (file.size > 100 * 1024 * 1024) {
      setError('File too large. Maximum size is 100MB.');
      return;
    }
    onFileSelected(file);
  }, [onFileSelected]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);

    if (isProcessing) return;

    const files = e.dataTransfer.files;
    if (files.length > 0) {
      handleFile(files[0]);
    }
  }, [handleFile, isProcessing]);

  const handleClick = useCallback(() => {
    if (isProcessing) return;
    inputRef.current?.click();
  }, [isProcessing]);

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      handleFile(files[0]);
    }
    e.target.value = '';
  }, [handleFile]);

  return (
    <div className="w-full">
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={handleClick}
        className={`
          relative overflow-hidden cursor-pointer
          border-2 border-dashed rounded-xl
          transition-all duration-300
          ${isDragOver
            ? 'border-green-400 bg-green-400/10'
            : 'border-white/15 bg-white/[0.03] hover:border-white/25 hover:bg-white/[0.05]'
          }
          ${isProcessing ? 'opacity-50 cursor-not-allowed' : ''}
        `}
      >
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPTED_EXTENSIONS.join(',')}
          onChange={handleInputChange}
          className="hidden"
        />

        <div className="flex flex-col items-center justify-center py-12 px-6">
          {isDragOver ? (
            <FileAudio className="w-16 h-16 text-green-400 mb-4" />
          ) : (
            <div className="relative">
              <Upload className="w-14 h-14 text-white/30 mb-4" />
              <Music className="w-6 h-6 text-green-400 absolute -bottom-1 -right-1" />
            </div>
          )}

          {isDragOver ? (
            <p className="text-green-400 font-medium text-lg">
              Drop your acapella here!
            </p>
          ) : (
            <div className="text-center">
              <p className="text-white/80 font-medium text-base mb-1">
                Drag & drop your acapella audio file
              </p>
              <p className="text-white/40 text-sm">
                or click to browse — WAV, MP3, OGG, FLAC supported
              </p>
            </div>
          )}
        </div>

        {/* Animated gradient border on drag */}
        {isDragOver && (
          <div
            className="absolute inset-0 rounded-xl pointer-events-none"
            style={{
              background: 'linear-gradient(135deg, rgba(34,197,94,0.1), transparent, rgba(34,197,94,0.1))',
            }}
          />
        )}
      </div>

      {/* Error message */}
      <AnimatePresence>
        {error && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="mt-3 flex items-center gap-2 text-red-400 text-sm bg-red-400/10 rounded-lg px-4 py-2"
          >
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            <span>{error}</span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
