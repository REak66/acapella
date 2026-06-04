'use client';

import React, { useRef, useEffect, useCallback } from 'react';

interface WaveformVisualizerProps {
  audioBuffer: AudioBuffer | null;
  currentTime: number;
  isPlaying: boolean;
  accentColor?: string;
}

export function WaveformVisualizer({
  audioBuffer,
  currentTime,
  isPlaying,
  accentColor = '#22c55e',
}: WaveformVisualizerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number>(0);
  const waveformCacheRef = useRef<Float32Array | null>(null);

  const drawWaveform = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    const width = rect.width;
    const height = rect.height;

    // Clear
    ctx.clearRect(0, 0, width, height);

    if (!audioBuffer) {
      // Draw placeholder
      ctx.fillStyle = 'rgba(255,255,255,0.05)';
      ctx.fillRect(0, 0, width, height);

      ctx.strokeStyle = 'rgba(255,255,255,0.1)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, height / 2);
      ctx.lineTo(width, height / 2);
      ctx.stroke();
      return;
    }

    // Get or compute waveform data
    if (!waveformCacheRef.current) {
      const channelData = audioBuffer.getChannelData(0);
      const samples = Math.min(width * 4, 4000);
      const blockSize = Math.floor(channelData.length / samples);
      const waveform = new Float32Array(samples);

      for (let i = 0; i < samples; i++) {
        let max = 0;
        const start = i * blockSize;
        for (let j = 0; j < blockSize; j++) {
          const abs = Math.abs(channelData[start + j] || 0);
          if (abs > max) max = abs;
        }
        waveform[i] = max;
      }
      waveformCacheRef.current = waveform;
    }

    const waveform = waveformCacheRef.current;
    const barWidth = width / waveform.length;
    const progressRatio = currentTime / audioBuffer.duration;

    // Draw bars
    for (let i = 0; i < waveform.length; i++) {
      const x = i * barWidth;
      const amplitude = waveform[i];
      const barHeight = Math.max(2, amplitude * height * 0.85);
      const y = (height - barHeight) / 2;

      const isPlayed = x / width < progressRatio;

      if (isPlayed) {
        ctx.fillStyle = accentColor;
        ctx.globalAlpha = 0.9;
      } else {
        ctx.fillStyle = 'rgba(255,255,255,0.3)';
        ctx.globalAlpha = 0.7;
      }

      // Rounded bar effect
      const bw = Math.max(barWidth - 1, 1);
      ctx.beginPath();
      ctx.roundRect(x, y, bw, barHeight, 1);
      ctx.fill();
    }

    ctx.globalAlpha = 1;

    // Draw playhead
    if (currentTime > 0 && currentTime < audioBuffer.duration) {
      const playheadX = progressRatio * width;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(playheadX - 1, 0, 2, height);

      // Glow effect
      const gradient = ctx.createLinearGradient(playheadX - 10, 0, playheadX + 10, 0);
      gradient.addColorStop(0, 'rgba(255,255,255,0)');
      gradient.addColorStop(0.5, 'rgba(255,255,255,0.15)');
      gradient.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = gradient;
      ctx.fillRect(playheadX - 10, 0, 20, height);
    }
  }, [audioBuffer, currentTime, accentColor]);

  useEffect(() => {
    if (isPlaying) {
      const animate = () => {
        drawWaveform();
        animationRef.current = requestAnimationFrame(animate);
      };
      animate();
    } else {
      drawWaveform();
    }

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [drawWaveform, isPlaying]);

  // Reset cache when audioBuffer changes
  useEffect(() => {
    waveformCacheRef.current = null;
  }, [audioBuffer]);

  // Handle resize
  useEffect(() => {
    const handleResize = () => drawWaveform();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [drawWaveform]);

  return (
    <canvas
      ref={canvasRef}
      className="w-full h-full"
      style={{ display: 'block' }}
    />
  );
}
