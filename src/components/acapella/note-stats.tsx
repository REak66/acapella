'use client';

import React from 'react';
import { Music, Clock, TrendingUp, BarChart3, Activity } from 'lucide-react';
import { DetectedNote, midiPitchToName } from '@/lib/audio-engine';

interface NoteStatsProps {
  notes: DetectedNote[];
  duration: number;
  bpm?: number;
}

export function NoteStats({ notes, duration, bpm = 120 }: NoteStatsProps) {
  if (notes.length === 0) return null;

  const avgAmplitude = notes.reduce((sum, n) => sum + n.amplitude, 0) / notes.length;
  const avgDuration = notes.reduce((sum, n) => sum + n.durationSeconds, 0) / notes.length;
  const pitches = notes.map(n => n.pitchMidi);
  const minPitch = Math.min(...pitches);
  const maxPitch = Math.max(...pitches);
  const notesPerSecond = notes.length / Math.max(duration, 0.01);

  // Find most common note
  const pitchCounts = new Map<number, number>();
  notes.forEach(n => pitchCounts.set(n.pitchMidi, (pitchCounts.get(n.pitchMidi) || 0) + 1));
  const mostCommonPitch = [...pitchCounts.entries()].sort((a, b) => b[1] - a[1])[0];

  const stats = [
    {
      icon: Music,
      label: 'Notes Detected',
      value: notes.length.toString(),
      sub: `${notesPerSecond.toFixed(1)} notes/sec`,
    },
    {
      icon: Activity,
      label: 'Tempo',
      value: `${bpm} BPM`,
      sub: `${(60 / bpm).toFixed(2)}s per beat`,
    },
    {
      icon: Clock,
      label: 'Avg Note Duration',
      value: `${(avgDuration * 1000).toFixed(0)}ms`,
      sub: `${avgDuration.toFixed(2)}s average`,
    },
    {
      icon: TrendingUp,
      label: 'Pitch Range',
      value: `${midiPitchToName(minPitch)} — ${midiPitchToName(maxPitch)}`,
      sub: `${maxPitch - minPitch} semitones`,
    },
    {
      icon: BarChart3,
      label: 'Most Common',
      value: mostCommonPitch ? midiPitchToName(mostCommonPitch[0]) : '—',
      sub: mostCommonPitch ? `${mostCommonPitch[1]} occurrences` : '',
    },
  ];

  return (
    <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
      {stats.map(({ icon: Icon, label, value, sub }) => (
        <div
          key={label}
          className="bg-white/[0.03] border border-white/[0.06] rounded-lg px-4 py-3"
        >
          <div className="flex items-center gap-2 mb-1.5">
            <Icon className="w-3.5 h-3.5 text-green-400/70" />
            <span className="text-[11px] text-white/40 font-medium uppercase tracking-wider">
              {label}
            </span>
          </div>
          <p className="text-white/90 font-semibold text-sm truncate">{value}</p>
          <p className="text-white/30 text-[11px] mt-0.5 truncate">{sub}</p>
        </div>
      ))}
    </div>
  );
}
