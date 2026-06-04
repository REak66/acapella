'use client';

import React, { useCallback, useRef, useState, useEffect } from 'react';
import { Play, Pause, SkipBack, Volume2, VolumeX } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';

interface AudioPlayerProps {
  audioBuffer: AudioBuffer | null;
  currentTime: number;
  onTimeUpdate: (time: number) => void;
  onPlayStateChange: (isPlaying: boolean) => void;
}

export function AudioPlayer({
  audioBuffer,
  currentTime,
  onTimeUpdate,
  onPlayStateChange,
}: AudioPlayerProps) {
  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<AudioBufferSourceNode | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const startTimeRef = useRef<number>(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [volume, setVolume] = useState(0.8);
  const [isMuted, setIsMuted] = useState(false);
  const animFrameRef = useRef<number>(0);
  const isPlayingRef = useRef(false);
  const audioBufferRef = useRef<AudioBuffer | null>(null);
  const onTimeUpdateRef = useRef(onTimeUpdate);

  // Keep refs in sync via useEffect
  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);
  useEffect(() => {
    audioBufferRef.current = audioBuffer;
  }, [audioBuffer]);
  useEffect(() => {
    onTimeUpdateRef.current = onTimeUpdate;
  }, [onTimeUpdate]);

  const stopAnimation = useCallback(() => {
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = 0;
    }
  }, []);

  const cleanup = useCallback(() => {
    stopAnimation();
    if (sourceRef.current) {
      try { sourceRef.current.stop(); } catch { /* already stopped */ }
      sourceRef.current = null;
    }
  }, [stopAnimation]);

  // Animation loop using refs to avoid circular dependencies
  const startAnimation = useCallback(() => {
    stopAnimation();
    const tick = () => {
      if (!audioContextRef.current || !isPlayingRef.current) return;
      const elapsed = audioContextRef.current.currentTime - startTimeRef.current;
      onTimeUpdateRef.current(Math.min(elapsed, audioBufferRef.current?.duration || 0));
      animFrameRef.current = requestAnimationFrame(tick);
    };
    tick();
  }, [stopAnimation]);

  const play = useCallback((fromTime?: number) => {
    if (!audioBuffer) return;

    cleanup();

    const ctx = new AudioContext();
    audioContextRef.current = ctx;

    const source = ctx.createBufferSource();
    source.buffer = audioBuffer;
    sourceRef.current = source;

    const gainNode = ctx.createGain();
    gainNode.gain.value = isMuted ? 0 : volume;
    gainNodeRef.current = gainNode;

    source.connect(gainNode);
    gainNode.connect(ctx.destination);

    const offset = fromTime !== undefined ? fromTime : currentTime;
    source.start(0, offset);
    startTimeRef.current = ctx.currentTime - offset;

    source.onended = () => {
      setIsPlaying(false);
      isPlayingRef.current = false;
      onPlayStateChange(false);
      onTimeUpdate(0);
    };

    setIsPlaying(true);
    isPlayingRef.current = true;
    onPlayStateChange(true);
    startAnimation();
  }, [audioBuffer, currentTime, volume, isMuted, cleanup, startAnimation, onPlayStateChange, onTimeUpdate]);

  const pause = useCallback(() => {
    if (!audioContextRef.current) return;
    const elapsed = audioContextRef.current.currentTime - startTimeRef.current;
    onTimeUpdate(Math.min(elapsed, audioBuffer?.duration || 0));
    cleanup();
    setIsPlaying(false);
    isPlayingRef.current = false;
    onPlayStateChange(false);
  }, [audioBuffer, cleanup, onTimeUpdate, onPlayStateChange]);

  const togglePlayPause = useCallback(() => {
    if (isPlaying) {
      pause();
    } else {
      play();
    }
  }, [isPlaying, play, pause]);

  const restart = useCallback(() => {
    cleanup();
    onTimeUpdate(0);
    if (isPlaying) {
      play(0);
    }
  }, [cleanup, isPlaying, play, onTimeUpdate]);

  const handleSeek = useCallback((value: number[]) => {
    const seekTime = value[0];
    onTimeUpdate(seekTime);
    if (isPlaying) {
      cleanup();
      play(seekTime);
    }
  }, [isPlaying, cleanup, play, onTimeUpdate]);

  const handleVolumeChange = useCallback((value: number[]) => {
    const newVolume = value[0];
    setVolume(newVolume);
    if (gainNodeRef.current) {
      gainNodeRef.current.gain.value = isMuted ? 0 : newVolume;
    }
  }, [isMuted]);

  const toggleMute = useCallback(() => {
    const newMuted = !isMuted;
    setIsMuted(newMuted);
    if (gainNodeRef.current) {
      gainNodeRef.current.gain.value = newMuted ? 0 : volume;
    }
  }, [isMuted, volume]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cleanup();
      if (audioContextRef.current) {
        audioContextRef.current.close();
      }
    };
  }, [cleanup]);

  const formatTime = (t: number) => {
    const mins = Math.floor(t / 60);
    const secs = Math.floor(t % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const duration = audioBuffer?.duration || 0;

  return (
    <div className="flex items-center gap-3 w-full">
      {/* Restart */}
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8 text-white/60 hover:text-white hover:bg-white/10"
        onClick={restart}
        disabled={!audioBuffer}
      >
        <SkipBack className="h-4 w-4" />
      </Button>

      {/* Play/Pause */}
      <Button
        variant="ghost"
        size="icon"
        className="h-10 w-10 bg-white/10 text-white hover:bg-white/20 hover:text-white rounded-full"
        onClick={togglePlayPause}
        disabled={!audioBuffer}
      >
        {isPlaying ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5 ml-0.5" />}
      </Button>

      {/* Time */}
      <span className="text-white/50 text-xs font-mono w-12 text-right">
        {formatTime(currentTime)}
      </span>

      {/* Seek bar */}
      <div className="flex-1 min-w-[60px]">
        <Slider
          value={[currentTime]}
          min={0}
          max={duration || 1}
          step={0.01}
          onValueChange={handleSeek}
          disabled={!audioBuffer}
          className="cursor-pointer"
        />
      </div>

      {/* Duration */}
      <span className="text-white/50 text-xs font-mono w-12">
        {formatTime(duration)}
      </span>

      {/* Volume */}
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8 text-white/60 hover:text-white hover:bg-white/10"
        onClick={toggleMute}
        disabled={!audioBuffer}
      >
        {isMuted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
      </Button>

      <div className="w-20 hidden sm:block">
        <Slider
          value={[isMuted ? 0 : volume]}
          min={0}
          max={1}
          step={0.01}
          onValueChange={handleVolumeChange}
          disabled={!audioBuffer}
          className="cursor-pointer"
        />
      </div>
    </div>
  );
}
