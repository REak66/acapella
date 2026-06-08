'use client';

import React, { useRef, useEffect, useCallback, useState } from 'react';
import { DetectedNote, midiPitchToName } from '@/lib/audio-engine';

interface PianoRollVisualizerProps {
  notes: DetectedNote[];
  duration: number;
  currentTime: number;
  isPlaying: boolean;
  bpm?: number;
  audioBuffer?: AudioBuffer | null;
  accentColor?: string;
}

// Layout constants
const PIANO_KEY_WIDTH = 60;
const HEADER_HEIGHT = 36;
const MIN_NOTE_HEIGHT = 12;
const MAX_NOTE_HEIGHT = 36;
const DEFAULT_NOTE_HEIGHT = 22;
const DEFAULT_PPS = 80;
const MIN_PPS = 10;
const MAX_PPS = 800;

// Smooth interpolation factor
const LERP = 0.18;
const FOLLOW_LERP = 0.08; // smoother follow for playback

// Color palette for amplitude levels — more distinct gradient
const AMP_COLORS = [
  'rgba(20, 140, 70, 0.45)',
  'rgba(30, 170, 80, 0.6)',
  'rgba(34, 197, 94, 0.75)',
  'rgba(52, 211, 130, 0.88)',
  'rgba(74, 222, 155, 1)',
];

const AMP_GLOW_COLORS = [
  'rgba(20, 140, 70, 0.15)',
  'rgba(30, 170, 80, 0.2)',
  'rgba(34, 197, 94, 0.3)',
  'rgba(52, 211, 130, 0.4)',
  'rgba(74, 222, 155, 0.5)',
];

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function PianoRollVisualizer({
  notes,
  duration,
  currentTime,
  isPlaying,
  bpm = 120,
  audioBuffer = null,
  accentColor = '#22c55e',
}: PianoRollVisualizerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number>(0);
  const zoomTextRef = useRef<HTMLSpanElement>(null);

  // Follow mode state
  const [followMode, setFollowMode] = useState(true);
  const followModeRef = useRef(true);
  const userInteractingRef = useRef(false);
  const userInteractTimeRef = useRef(0);

  // Ruler mode
  const [rulerMode, setRulerMode] = useState<'beats' | 'time'>('beats');
  const rulerModeRef = useRef<'beats' | 'time'>('beats');

  // Keep refs in sync
  useEffect(() => { followModeRef.current = followMode; }, [followMode]);
  useEffect(() => { rulerModeRef.current = rulerMode; }, [rulerMode]);

  // ── All view state in refs for 60fps updates without React re-renders ──
  const viewRef = useRef({
    targetScrollX: 0,
    targetScrollY: 0,
    targetPps: DEFAULT_PPS,
    targetNoteHeight: DEFAULT_NOTE_HEIGHT,
    scrollX: 0,
    scrollY: 0,
    pps: DEFAULT_PPS,
    noteHeight: DEFAULT_NOTE_HEIGHT,
    canvasW: 0,
    canvasH: 0,
    needsResize: true,
  });

  // Drag state
  const dragRef = useRef({
    active: false,
    startX: 0,
    startY: 0,
    startScrollX: 0,
    startScrollY: 0,
  });

  // Hover state
  const [hoveredNote, setHoveredNote] = useState<DetectedNote | null>(null);
  const [mousePos, setMousePos] = useState<{ x: number; y: number } | null>(null);
  const notesLayoutRef = useRef<{ note: DetectedNote; x: number; y: number; w: number; h: number }[]>([]);

  // Pitch range cache
  const pitchRangeRef = useRef({ min: 0, max: 127, range: 128 });

  // BPM ref for drawing
  const bpmRef = useRef(bpm);
  useEffect(() => { bpmRef.current = bpm; }, [bpm]);

  // Current time ref for drawing
  const currentTimeRef = useRef(currentTime);
  useEffect(() => { currentTimeRef.current = currentTime; }, [currentTime]);

  // isPlaying ref
  const isPlayingRef = useRef(isPlaying);
  useEffect(() => { isPlayingRef.current = isPlaying; }, [isPlaying]);

  // Pre-computed spectrogram data for pitch-mapped frequency visualization
  const spectrogramRef = useRef<{ data: Float32Array; timeSteps: number; pitchBins: number; hopSize: number; sampleRate: number } | null>(null);

  useEffect(() => {
    if (!audioBuffer) {
      spectrogramRef.current = null;
      return;
    }

    let cancelled = false;

    // Compute pitch-mapped spectrogram asynchronously
    const channelData = audioBuffer.getChannelData(0);
    const sampleRate = audioBuffer.sampleRate;
    const dur = audioBuffer.duration;
    const fftSize = 1024; // smaller FFT for better time resolution and speed
    // Larger hop for long files to keep computation fast
    const hopMs = dur > 120 ? 0.05 : dur > 30 ? 0.03 : 0.02;
    const hopSize = Math.floor(sampleRate * hopMs);
    const timeSteps = Math.floor((channelData.length - fftSize) / hopSize);
    
    if (timeSteps <= 0) return;

    const pitchBins = 128;
    const data = new Float32Array(timeSteps * pitchBins);

    // Pre-compute frequency for each MIDI pitch
    const pitchFreqs = new Float32Array(pitchBins);
    for (let p = 0; p < pitchBins; p++) {
      pitchFreqs[p] = 440 * Math.pow(2, (p - 69) / 12);
    }

    // Hann window
    const hannWindow = new Float32Array(fftSize);
    for (let i = 0; i < fftSize; i++) {
      hannWindow[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (fftSize - 1)));
    }

    // Process in chunks to avoid blocking UI
    const CHUNK_SIZE = 400; // larger chunk size is fine since loop is optimized
    let currentChunk = 0;

    const processChunk = () => {
      if (cancelled) return;
      
      const startT = currentChunk * CHUNK_SIZE;
      const endT = Math.min(startT + CHUNK_SIZE, timeSteps);

      for (let t = startT; t < endT; t++) {
        const offset = t * hopSize;
        if (offset + fftSize > channelData.length) continue;

        // Compute Goertzel magnitude for vocal pitches (MIDI 28-95)
        for (let p = 28; p < 96; p++) {
          const freq = pitchFreqs[p];
          if (freq < 30 || freq > sampleRate / 2) continue;

          // Goertzel algorithm — exact frequency DFT
          const omega = 2 * Math.PI * freq / sampleRate;
          const coeff = 2 * Math.cos(omega);
          let s1 = 0, s2 = 0;

          // Process every sample with window (mathematically correct)
          for (let i = 0; i < fftSize; i++) {
            const sample = channelData[offset + i] * hannWindow[i];
            const s0 = sample + coeff * s1 - s2;
            s2 = s1;
            s1 = s0;
          }

          const power = Math.sqrt(s1 * s1 + s2 * s2 - coeff * s1 * s2) / (fftSize / 2);
          // Scale so energy trails are clearly visible
          data[t * pitchBins + p] = Math.min(1, power * 12);
        }
      }

      // Update ref with partial data so it renders progressively
      spectrogramRef.current = { data, timeSteps, pitchBins, hopSize, sampleRate };

      currentChunk++;
      if (startT + CHUNK_SIZE < timeSteps && !cancelled) {
        setTimeout(processChunk, 0); // yield to UI thread
      }
    };

    // Start async computation
    setTimeout(processChunk, 50);

    return () => { cancelled = true; };
  }, [audioBuffer]);

  // ── Calculate pitch range when notes change ──
  useEffect(() => {
    if (notes.length === 0) return;
    const pitches = notes.map(n => n.pitchMidi);
    const minPitch = Math.max(0, Math.min(...pitches) - 3);
    const maxPitch = Math.min(127, Math.max(...pitches) + 3);
    pitchRangeRef.current = { min: minPitch, max: maxPitch, range: maxPitch - minPitch + 1 };
  }, [notes]);

  // ── Auto-fit view when notes first appear ──
  useEffect(() => {
    if (notes.length === 0) return;
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const rollWidth = rect.width - PIANO_KEY_WIDTH;
    const rollHeight = rect.height - HEADER_HEIGHT;
    const { range: pitchRange } = pitchRangeRef.current;

    const fitNh = Math.max(MIN_NOTE_HEIGHT, Math.min(MAX_NOTE_HEIGHT, rollHeight / pitchRange));
    const totalH = pitchRange * fitNh;
    const yOffset = Math.max(0, (totalH - rollHeight) / 2);

    const fitPps = rollWidth / Math.max(duration, 1);
    const usePps = (fitPps >= MIN_PPS && fitPps <= MAX_PPS) ? fitPps : DEFAULT_PPS;

    const v = viewRef.current;
    v.targetNoteHeight = fitNh;
    v.targetScrollY = yOffset;
    v.targetPps = usePps;
    v.targetScrollX = 0;
    v.noteHeight = fitNh;
    v.scrollY = yOffset;
    v.pps = usePps;
    v.scrollX = 0;
  }, [notes, duration]);

  // ─── Drawing ───
  const drawPianoRoll = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const v = viewRef.current;
    const { scrollX, scrollY, pps, noteHeight } = v;
    const notesArr = notes;
    const dur = duration;
    const curTime = currentTimeRef.current;
    const curBpm = bpmRef.current;

    const dpr = window.devicePixelRatio || 1;
    const rect = container.getBoundingClientRect();
    const width = rect.width;
    const height = rect.height;

    const cw = Math.round(width * dpr);
    const ch = Math.round(height * dpr);
    if (canvas.width !== cw || canvas.height !== ch) {
      canvas.width = cw;
      canvas.height = ch;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const rollWidth = width - PIANO_KEY_WIDTH;
    const rollHeight = height - HEADER_HEIGHT;

    // Clear
    ctx.fillStyle = '#060606';
    ctx.fillRect(0, 0, width, height);

    if (notesArr.length === 0) {
      ctx.fillStyle = 'rgba(255,255,255,0.15)';
      ctx.font = '14px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('No notes detected yet', width / 2, height / 2);
      return;
    }

    const { min: minPitch, max: maxPitch, range: pitchRange } = pitchRangeRef.current;
    const visibleStartTime = scrollX;
    const visibleEndTime = scrollX + rollWidth / pps;

    // Beat calculation
    const beatDuration = 60 / curBpm; // seconds per beat

    // ─── Header (time/beat ruler) ───
    ctx.fillStyle = '#0d0d0d';
    ctx.fillRect(PIANO_KEY_WIDTH, 0, rollWidth, HEADER_HEIGHT);
    ctx.strokeStyle = 'rgba(255,255,255,0.1)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(PIANO_KEY_WIDTH, HEADER_HEIGHT);
    ctx.lineTo(width, HEADER_HEIGHT);
    ctx.stroke();

    if (rulerModeRef.current === 'beats') {
      // ─── Beat grid ruler ───
      const startBeat = Math.floor(visibleStartTime / beatDuration);
      const endBeat = Math.ceil(visibleEndTime / beatDuration) + 1;

      for (let beat = startBeat; beat <= endBeat; beat++) {
        if (beat < 0) continue;
        const t = beat * beatDuration;
        const x = PIANO_KEY_WIDTH + (t - scrollX) * pps;
        if (x < PIANO_KEY_WIDTH - 20 || x > width + 20) continue;

        const isBar = beat % 4 === 0;
        const barNum = Math.floor(beat / 4) + 1;
        const beatInBar = (beat % 4) + 1;

        // Header labels
        if (isBar) {
          ctx.fillStyle = 'rgba(255,255,255,0.6)';
          ctx.font = 'bold 10px system-ui, sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText(`${barNum}`, x, 14);
          ctx.fillStyle = 'rgba(255,255,255,0.25)';
          ctx.font = '9px system-ui, sans-serif';
          ctx.fillText(`bar`, x, 26);
        } else {
          ctx.fillStyle = 'rgba(255,255,255,0.3)';
          ctx.font = '9px system-ui, sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText(`${barNum}.${beatInBar}`, x, 14);
        }

        // Vertical grid lines
        if (isBar) {
          ctx.strokeStyle = 'rgba(255,255,255,0.12)';
          ctx.lineWidth = 1;
        } else {
          ctx.strokeStyle = 'rgba(255,255,255,0.05)';
          ctx.lineWidth = 0.5;
        }
        ctx.beginPath();
        ctx.moveTo(x, HEADER_HEIGHT);
        ctx.lineTo(x, height);
        ctx.stroke();

        // Sub-beat lines (eighth notes) for high zoom
        if (pps > 100) {
          const subX = PIANO_KEY_WIDTH + (t + beatDuration / 2 - scrollX) * pps;
          if (subX > PIANO_KEY_WIDTH && subX < width) {
            ctx.strokeStyle = 'rgba(255,255,255,0.02)';
            ctx.lineWidth = 0.5;
            ctx.beginPath();
            ctx.moveTo(subX, HEADER_HEIGHT);
            ctx.lineTo(subX, height);
            ctx.stroke();
          }
        }
      }
    } else {
      // ─── Time ruler (seconds) ───
      const timeStep = getTimeStep(pps);
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.font = '10px system-ui, sans-serif';
      ctx.textAlign = 'center';
      const startT = Math.floor(visibleStartTime / timeStep) * timeStep;
      for (let t = startT; t <= visibleEndTime + timeStep; t += timeStep) {
        if (t < 0) continue;
        const x = PIANO_KEY_WIDTH + (t - scrollX) * pps;
        if (x < PIANO_KEY_WIDTH - 20 || x > width + 20) continue;
        ctx.fillText(formatTime(t), x, 22);
        ctx.strokeStyle = 'rgba(255,255,255,0.06)';
        ctx.lineWidth = 0.5;
        ctx.beginPath();
        ctx.moveTo(x, HEADER_HEIGHT);
        ctx.lineTo(x, height);
        ctx.stroke();
      }
    }

    // ─── Clip the roll area ───
    ctx.save();
    ctx.beginPath();
    ctx.rect(PIANO_KEY_WIDTH, HEADER_HEIGHT, rollWidth, rollHeight);
    ctx.clip();

    const noteLayouts: { note: DetectedNote; x: number; y: number; w: number; h: number }[] = [];

    // ─── Grid rows ───
    for (let i = 0; i < pitchRange; i++) {
      const pitch = maxPitch - i; // high pitch at the top, low pitch at the bottom
      const y = HEADER_HEIGHT + i * noteHeight - scrollY;
      if (y + noteHeight < HEADER_HEIGHT || y > height) continue;

      const noteName = midiPitchToName(pitch);
      const isSharp = noteName.includes('#');
      const isC = noteName.startsWith('C') && !noteName.includes('#');

      if (isSharp) {
        ctx.fillStyle = 'rgba(0,0,0,0.4)';
      } else {
        ctx.fillStyle = 'rgba(255,255,255,0.015)';
      }
      ctx.fillRect(PIANO_KEY_WIDTH, y, rollWidth, noteHeight);

      if (isC) {
        ctx.strokeStyle = 'rgba(255,255,255,0.12)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        // Since pitch is descending, Octave boundary line is at the bottom of the C note row
        ctx.moveTo(PIANO_KEY_WIDTH, y + noteHeight);
        ctx.lineTo(width, y + noteHeight);
        ctx.stroke();
      } else {
        ctx.strokeStyle = 'rgba(255,255,255,0.025)';
        ctx.lineWidth = 0.5;
        ctx.beginPath();
        ctx.moveTo(PIANO_KEY_WIDTH, y + noteHeight);
        ctx.lineTo(width, y + noteHeight);
        ctx.stroke();
      }
    }

    // ─── Spectrogram overlay (shows actual vocal frequencies at each pitch row) ───
    const spec = spectrogramRef.current;
    if (spec && spec.data.length > 0) {
      const { data: specData, timeSteps, pitchBins, hopSize, sampleRate } = spec;
      const hopTime = hopSize / sampleRate;

      // Draw spectrogram behind notes — each pixel column is a time frame
      // Each row corresponds to a MIDI pitch (high on top, low on bottom)
      const pixelStep = Math.max(1, Math.floor(2 / (pps * hopTime))); // skip frames for speed
      
      for (let t = 0; t < timeSteps; t += Math.max(1, pixelStep)) {
        const frameTime = t * hopTime;
        if (frameTime < visibleStartTime - 0.1 || frameTime > visibleEndTime + 0.1) continue;
        
        const xPos = PIANO_KEY_WIDTH + (frameTime - scrollX) * pps;
        if (xPos < PIANO_KEY_WIDTH || xPos > width) continue;

        const colWidth = Math.max(1.5, pps * hopTime * Math.max(1, pixelStep));

        for (let p = minPitch; p <= maxPitch; p++) {
          if (p < 0 || p >= pitchBins) continue;
          const energy = specData[t * pitchBins + p];
          if (energy < 0.02) continue; // skip very low energy

          const yPos = HEADER_HEIGHT + (maxPitch - p) * noteHeight - scrollY;
          if (yPos + noteHeight < HEADER_HEIGHT || yPos > height) continue;

          // Color: HSL emerald-cyan glow for a modern visual feel
          const intensity = Math.min(1, energy * 3.5);
          const alpha = intensity * 0.22;
          const h = 140 + intensity * 20; // 140 is emerald, 160 is cyan
          const s = 80 + intensity * 20;
          const l = 30 + intensity * 25;
          ctx.fillStyle = `hsla(${h}, ${s}%, ${l}%, ${alpha})`;
          ctx.fillRect(xPos, yPos, colWidth, noteHeight);
        }
      }
    }

    // ─── Detected notes ───
    for (const note of notesArr) {
      const x = PIANO_KEY_WIDTH + (note.startTimeSeconds - scrollX) * pps;
      const nw = Math.max(5, note.durationSeconds * pps);
      const ny = HEADER_HEIGHT + (maxPitch - note.pitchMidi) * noteHeight - scrollY;
      const nh = noteHeight;

      if (x + nw < PIANO_KEY_WIDTH || x > width) continue;
      if (ny + nh < HEADER_HEIGHT || ny > height) continue;

      const noteName = midiPitchToName(note.pitchMidi);
      noteLayouts.push({ note, x, y: ny, w: nw, h: nh });

      const ampLevel = Math.min(4, Math.floor(note.amplitude * 5));
      const isActive = curTime >= note.startTimeSeconds && curTime <= note.startTimeSeconds + note.durationSeconds;
      const radius = Math.min(5, nh / 3);
      const drawW = nw > 4 ? nw - 1 : nw; // 1px gap between consecutive notes

      // ── Active note glow ──
      if (isActive) {
        ctx.shadowColor = 'rgba(34, 197, 94, 0.6)';
        ctx.shadowBlur = 12;
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 0;
      }

      // ── Shadow ──
      ctx.fillStyle = 'rgba(0,0,0,0.4)';
      ctx.beginPath();
      ctx.roundRect(x + 1, ny + 2, drawW, nh - 1, radius);
      ctx.fill();

      // ── Body ──
      const bodyColor = isActive ? 'rgba(74, 222, 155, 1)' : (accentColor === '#22c55e' ? AMP_COLORS[ampLevel] : accentColor);
      ctx.fillStyle = bodyColor;
      ctx.beginPath();
      ctx.roundRect(x, ny + 1, drawW, nh - 2, radius);
      ctx.fill();

      // Reset shadow
      ctx.shadowColor = 'transparent';
      ctx.shadowBlur = 0;

      // ── Border for clarity ──
      ctx.strokeStyle = isActive ? 'rgba(255,255,255,0.35)' : 'rgba(255,255,255,0.08)';
      ctx.lineWidth = isActive ? 1.5 : 0.5;
      ctx.beginPath();
      ctx.roundRect(x, ny + 1, drawW, nh - 2, radius);
      ctx.stroke();

      // ── Highlight gradient ──
      const hg = ctx.createLinearGradient(x, ny + 1, x, ny + nh - 2);
      hg.addColorStop(0, isActive ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.2)');
      hg.addColorStop(0.25, 'rgba(255,255,255,0.06)');
      hg.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = hg;
      ctx.beginPath();
      ctx.roundRect(x, ny + 1, drawW, nh - 2, radius);
      ctx.fill();

      // ── Pitch bend visualization ──
      if (note.pitchBends && note.pitchBends.length > 1 && drawW > 10) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(x, ny + 1, drawW, nh - 2);
        ctx.clip();

        ctx.strokeStyle = isActive ? 'rgba(255,255,255,0.4)' : 'rgba(255,255,255,0.15)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        const bendLen = note.pitchBends.length;
        const midY = ny + nh / 2;
        const bendScale = (nh - 4) / 2; // max deflection in pixels
        for (let bi = 0; bi < bendLen; bi++) {
          const bx = x + (bi / (bendLen - 1)) * drawW;
          const by = midY - (note.pitchBends[bi] || 0) * bendScale;
          if (bi === 0) ctx.moveTo(bx, by);
          else ctx.lineTo(bx, by);
        }
        ctx.stroke();
        ctx.restore();
      }

      // ── Note label ──
      const labelFontSize = Math.min(12, nh - 4);
      if (drawW > 28 && labelFontSize >= 7) {
        ctx.font = `bold ${labelFontSize}px system-ui, sans-serif`;
        ctx.textAlign = 'left';
        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        ctx.fillText(noteName, x + 5, ny + nh - 5);
        ctx.fillStyle = isActive ? 'rgba(255,255,255,1)' : 'rgba(255,255,255,0.9)';
        ctx.fillText(noteName, x + 4, ny + nh - 6);
      } else if (labelFontSize >= 7 && drawW > 10) {
        const sf = Math.min(9, labelFontSize);
        ctx.font = `bold ${sf}px system-ui, sans-serif`;
        ctx.textAlign = 'center';
        const lw = ctx.measureText(noteName).width + 8;
        const lx = x + drawW / 2;
        const ly = ny - 3;
        ctx.fillStyle = 'rgba(0,0,0,0.8)';
        ctx.beginPath();
        ctx.roundRect(lx - lw / 2, ly - sf - 2, lw, sf + 4, 3);
        ctx.fill();
        ctx.strokeStyle = 'rgba(34, 197, 94, 0.3)';
        ctx.lineWidth = 0.5;
        ctx.beginPath();
        ctx.roundRect(lx - lw / 2, ly - sf - 2, lw, sf + 4, 3);
        ctx.stroke();
        ctx.fillStyle = 'rgba(34, 197, 94, 0.95)';
        ctx.fillText(noteName, lx, ly - 1);
      }
    }

    notesLayoutRef.current = noteLayouts;

    // ─── Playhead ───
    if (curTime > 0) {
      const px = PIANO_KEY_WIDTH + (curTime - scrollX) * pps;
      if (px >= PIANO_KEY_WIDTH && px <= width) {
        // Glow effect
        const glowGrad = ctx.createLinearGradient(px - 40, 0, px + 40, 0);
        glowGrad.addColorStop(0, 'rgba(34, 197, 94, 0)');
        glowGrad.addColorStop(0.3, 'rgba(34, 197, 94, 0.04)');
        glowGrad.addColorStop(0.5, 'rgba(34, 197, 94, 0.08)');
        glowGrad.addColorStop(0.7, 'rgba(34, 197, 94, 0.04)');
        glowGrad.addColorStop(1, 'rgba(34, 197, 94, 0)');
        ctx.fillStyle = glowGrad;
        ctx.fillRect(px - 40, HEADER_HEIGHT, 80, rollHeight);

        // Playhead line
        ctx.fillStyle = 'rgba(255,255,255,0.95)';
        ctx.fillRect(px - 0.75, HEADER_HEIGHT, 1.5, rollHeight);

        // Playhead triangle
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.moveTo(px - 6, HEADER_HEIGHT);
        ctx.lineTo(px + 6, HEADER_HEIGHT);
        ctx.lineTo(px, HEADER_HEIGHT + 8);
        ctx.closePath();
        ctx.fill();

        // Time badge on playhead
        ctx.fillStyle = 'rgba(0,0,0,0.85)';
        ctx.beginPath();
        const timeTxt = formatTimeCompact(curTime);
        ctx.font = 'bold 9px system-ui, sans-serif';
        const tw = ctx.measureText(timeTxt).width + 8;
        ctx.roundRect(px - tw/2, 1, tw, 14, 3);
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.3)';
        ctx.lineWidth = 0.5;
        ctx.beginPath();
        ctx.roundRect(px - tw/2, 1, tw, 14, 3);
        ctx.stroke();
        ctx.fillStyle = '#fff';
        ctx.textAlign = 'center';
        ctx.fillText(timeTxt, px, 12);
      }
    }

    ctx.restore();

    // ─── Piano keyboard sidebar ───
    drawPianoKeys(ctx, minPitch, pitchRange, noteHeight, scrollY, width, height, notesArr, curTime);

    // Border
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 1;
    ctx.strokeRect(0, 0, width, height);

    // ─── Mini-map ───
    drawMinimap(ctx, notesArr, dur, scrollX, rollWidth, pps, width, height, rollHeight, minPitch, maxPitch, pitchRange, noteHeight, scrollY, curTime);

  }, [notes, duration, accentColor]);

  // ─── Smooth animation loop ───
  useEffect(() => {
    let running = true;

    const tick = () => {
      if (!running) return;

      const v = viewRef.current;

      // ── Auto-follow playhead ──
      if (isPlayingRef.current && followModeRef.current && !userInteractingRef.current) {
        const container = containerRef.current;
        if (container) {
          const rect = container.getBoundingClientRect();
          const rollWidth = rect.width - PIANO_KEY_WIDTH;
          // Keep playhead at ~30% from left
          const targetX = currentTimeRef.current - (rollWidth * 0.3) / v.targetPps;
          const maxScrollX = Math.max(0, duration - rollWidth / v.targetPps);
          v.targetScrollX = Math.max(0, Math.min(maxScrollX, targetX));
        }
      }

      // Check if user stopped interacting (after 1.5s of no interaction, re-enable follow)
      if (userInteractingRef.current && Date.now() - userInteractTimeRef.current > 1500) {
        userInteractingRef.current = false;
      }

      // Interpolate toward targets
      const dx = v.targetScrollX - v.scrollX;
      const dy = v.targetScrollY - v.scrollY;
      const dp = v.targetPps - v.pps;
      const dn = v.targetNoteHeight - v.noteHeight;

      const threshold = 0.01;
      const useLerp = isPlayingRef.current && followModeRef.current ? FOLLOW_LERP : LERP;
      v.scrollX = Math.abs(dx) < threshold ? v.targetScrollX : lerp(v.scrollX, v.targetScrollX, useLerp);
      v.scrollY = Math.abs(dy) < threshold ? v.targetScrollY : lerp(v.scrollY, v.targetScrollY, LERP);
      v.pps = Math.abs(dp) < 0.05 ? v.targetPps : lerp(v.pps, v.targetPps, LERP);
      v.noteHeight = Math.abs(dn) < 0.01 ? v.targetNoteHeight : lerp(v.noteHeight, v.targetNoteHeight, LERP);

      drawPianoRoll();

      if (zoomTextRef.current) {
        const zoomPercent = Math.round((v.pps / DEFAULT_PPS) * 100);
        zoomTextRef.current.textContent = `${zoomPercent}%`;
      }

      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      running = false;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [drawPianoRoll, duration]);

  // ─── Wheel handler ───
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();

      // Mark user interaction
      userInteractingRef.current = true;
      userInteractTimeRef.current = Date.now();

      const v = viewRef.current;

      if (e.ctrlKey || e.metaKey) {
        if (e.shiftKey) {
          const delta = -e.deltaY * 0.01;
          v.targetNoteHeight = Math.max(MIN_NOTE_HEIGHT, Math.min(MAX_NOTE_HEIGHT, v.targetNoteHeight * (1 + delta)));
        } else {
          const rect = container.getBoundingClientRect();
          const mouseX = e.clientX - rect.left - PIANO_KEY_WIDTH;
          const timeAtCursor = v.targetScrollX + mouseX / v.targetPps;
          const zoomDelta = -e.deltaY * 0.002;
          const factor = Math.exp(zoomDelta);
          const newPps = Math.max(MIN_PPS, Math.min(MAX_PPS, v.targetPps * factor));
          v.targetScrollX = Math.max(0, timeAtCursor - mouseX / newPps);
          v.targetPps = newPps;
        }
      } else if (e.shiftKey) {
        const delta = e.deltaY / v.pps;
        const maxScrollX = Math.max(0, duration - (container.getBoundingClientRect().width - PIANO_KEY_WIDTH) / v.targetPps);
        v.targetScrollX = Math.max(0, Math.min(maxScrollX, v.targetScrollX + delta));
      } else {
        let dy = e.deltaY;
        if (e.deltaMode === 1) dy *= 40;
        if (e.deltaMode === 2) dy *= 800;
        v.targetScrollY = Math.max(0, v.targetScrollY + dy * 0.4);
      }
    };

    container.addEventListener('wheel', onWheel, { passive: false });
    return () => container.removeEventListener('wheel', onWheel);
  }, [duration]);

  // ─── Drag to pan ───
  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    if (e.clientX - rect.left < PIANO_KEY_WIDTH) return;

    userInteractingRef.current = true;
    userInteractTimeRef.current = Date.now();

    const v = viewRef.current;
    dragRef.current = {
      active: true,
      startX: e.clientX,
      startY: e.clientY,
      startScrollX: v.targetScrollX,
      startScrollY: v.targetScrollY,
    };
  }, []);

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    const v = viewRef.current;

    if (drag.active) {
      userInteractingRef.current = true;
      userInteractTimeRef.current = Date.now();
      const dx = e.clientX - drag.startX;
      const dy = e.clientY - drag.startY;
      v.targetScrollX = Math.max(0, drag.startScrollX - dx / v.pps);
      v.targetScrollY = Math.max(0, drag.startScrollY - dy);
      return;
    }

    // Hover detection
    const container = containerRef.current;
    if (!container || notesLayoutRef.current.length === 0) return;
    const rect = container.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    let found: DetectedNote | null = null;
    for (const layout of notesLayoutRef.current) {
      if (mx >= layout.x && mx <= layout.x + layout.w &&
          my >= layout.y && my <= layout.y + layout.h) {
        found = layout.note;
        break;
      }
    }
    setHoveredNote(found);
    setMousePos(found ? { x: e.clientX, y: e.clientY } : null);
  }, []);

  const handleMouseUp = useCallback(() => {
    dragRef.current.active = false;
  }, []);

  const handleMouseLeave = useCallback(() => {
    dragRef.current.active = false;
    setHoveredNote(null);
    setMousePos(null);
  }, []);

  // ─── Zoom button handlers ───
  const handleZoomIn = useCallback(() => {
    viewRef.current.targetPps = Math.min(MAX_PPS, viewRef.current.targetPps * 1.4);
  }, []);

  const handleZoomOut = useCallback(() => {
    viewRef.current.targetPps = Math.max(MIN_PPS, viewRef.current.targetPps / 1.4);
  }, []);

  const handleFitView = useCallback(() => {
    if (notes.length === 0) return;
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const rollWidth = rect.width - PIANO_KEY_WIDTH;
    const rollHeight = rect.height - HEADER_HEIGHT;
    const { range: pitchRange } = pitchRangeRef.current;

    const fitPps = rollWidth / Math.max(duration, 1);
    const v = viewRef.current;
    v.targetPps = Math.max(MIN_PPS, Math.min(MAX_PPS, fitPps));
    v.targetScrollX = 0;

    const fitNh = Math.max(MIN_NOTE_HEIGHT, Math.min(MAX_NOTE_HEIGHT, rollHeight / pitchRange));
    v.targetNoteHeight = fitNh;
    const totalH = pitchRange * fitNh;
    v.targetScrollY = Math.max(0, (totalH - rollHeight) / 2);
  }, [notes, duration]);

  // ─── Touch support ───
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let lastTouches: TouchList | null = null;
    let lastPanPos: { x: number; y: number } | null = null;

    const onTouchStart = (e: TouchEvent) => {
      userInteractingRef.current = true;
      userInteractTimeRef.current = Date.now();
      if (e.touches.length === 1) {
        lastPanPos = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      }
      if (e.touches.length === 2) {
        lastTouches = e.touches;
        lastPanPos = null;
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      e.preventDefault();
      const v = viewRef.current;
      userInteractingRef.current = true;
      userInteractTimeRef.current = Date.now();

      if (e.touches.length === 1 && lastPanPos) {
        const dx = e.touches[0].clientX - lastPanPos.x;
        const dy = e.touches[0].clientY - lastPanPos.y;
        v.targetScrollX = Math.max(0, v.targetScrollX - dx / v.pps);
        v.targetScrollY = Math.max(0, v.targetScrollY - dy);
        lastPanPos = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      }

      if (e.touches.length === 2 && lastTouches) {
        const prevDist = Math.hypot(
          lastTouches[0].clientX - lastTouches[1].clientX,
          lastTouches[0].clientY - lastTouches[1].clientY
        );
        const currDist = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY
        );
        const scale = currDist / prevDist;
        v.targetPps = Math.max(MIN_PPS, Math.min(MAX_PPS, v.targetPps * scale));
        lastTouches = e.touches;
      }
    };

    const onTouchEnd = () => {
      lastTouches = null;
      lastPanPos = null;
    };

    container.addEventListener('touchstart', onTouchStart, { passive: false });
    container.addEventListener('touchmove', onTouchMove, { passive: false });
    container.addEventListener('touchend', onTouchEnd);
    return () => {
      container.removeEventListener('touchstart', onTouchStart);
      container.removeEventListener('touchmove', onTouchMove);
      container.removeEventListener('touchend', onTouchEnd);
    };
  }, []);

  return (
    <div className="relative w-full h-full flex flex-col">
      {/* Toolbar */}
      <div className="absolute top-2 right-2 z-10 flex items-center gap-1">
        {/* BPM display */}
        <div className="flex items-center gap-1 mr-2 px-2 py-1 rounded-md bg-white/[0.06] border border-white/[0.08]">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className="text-green-400">
            <circle cx="6" cy="6" r="5" stroke="currentColor" strokeWidth="1.2" />
            <line x1="6" y1="6" x2="6" y2="2.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
            <line x1="6" y1="6" x2="8.5" y2="7" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
          </svg>
          <span className="text-[10px] text-green-400 font-mono font-bold">{bpm}</span>
          <span className="text-[9px] text-white/30">BPM</span>
        </div>

        {/* Ruler mode toggle */}
        <button
          onClick={() => setRulerMode(m => m === 'beats' ? 'time' : 'beats')}
          className={`h-7 px-2 flex items-center justify-center rounded-md text-[10px] font-mono transition-colors ${
            rulerMode === 'beats'
              ? 'text-green-400/80 bg-green-400/10 hover:bg-green-400/15'
              : 'text-white/40 hover:text-white/60 hover:bg-white/10'
          }`}
          title={`Ruler: ${rulerMode === 'beats' ? 'Beats' : 'Time'}`}
        >
          {rulerMode === 'beats' ? '♩' : '⏱'}
        </button>

        {/* Follow toggle */}
        <button
          onClick={() => setFollowMode(f => !f)}
          className={`w-7 h-7 flex items-center justify-center rounded-md transition-colors ${
            followMode
              ? 'text-green-400 bg-green-400/15 hover:bg-green-400/20'
              : 'text-white/35 hover:text-white/60 hover:bg-white/10'
          }`}
          title={followMode ? 'Auto-follow: ON' : 'Auto-follow: OFF'}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5">
            {followMode ? (
              <>
                <rect x="2" y="4" width="10" height="6" rx="1" />
                <line x1="7" y1="2" x2="7" y2="12" />
                <polyline points="5,3 7,1 9,3" />
              </>
            ) : (
              <>
                <rect x="2" y="4" width="10" height="6" rx="1" />
                <line x1="7" y1="4" x2="7" y2="10" strokeDasharray="1.5 1.5" />
              </>
            )}
          </svg>
        </button>

        <div className="w-px h-5 bg-white/10 mx-0.5" />

        <button
          onClick={handleZoomOut}
          className="w-7 h-7 flex items-center justify-center rounded-md text-white/50 hover:text-white hover:bg-white/10 transition-colors text-sm font-bold"
          title="Zoom out"
        >
          −
        </button>
        <span
          ref={zoomTextRef}
          className="text-[10px] text-white/35 font-mono w-10 text-center select-none"
        >
          100%
        </span>
        <button
          onClick={handleZoomIn}
          className="w-7 h-7 flex items-center justify-center rounded-md text-white/50 hover:text-white hover:bg-white/10 transition-colors text-sm font-bold"
          title="Zoom in"
        >
          +
        </button>
        <button
          onClick={handleFitView}
          className="w-7 h-7 flex items-center justify-center rounded-md text-white/50 hover:text-white hover:bg-white/10 transition-colors"
          title="Fit to view"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5">
            <rect x="1" y="1" width="12" height="12" rx="2" />
            <line x1="5" y1="1" x2="5" y2="13" />
            <line x1="9" y1="1" x2="9" y2="13" />
            <line x1="1" y1="5" x2="13" y2="5" />
            <line x1="1" y1="9" x2="13" y2="9" />
          </svg>
        </button>
      </div>

      {/* Canvas area */}
      <div
        ref={containerRef}
        className="w-full flex-1 cursor-grab active:cursor-grabbing overflow-hidden rounded-md"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseLeave}
      >
        <canvas
          ref={canvasRef}
          className="w-full h-full"
          style={{ display: 'block' }}
        />
      </div>

      {/* Scroll hint */}
      {notes.length > 0 && (
        <div className="absolute bottom-3 left-16 text-[10px] text-white/20 pointer-events-none select-none">
          Scroll: vertical &bull; Shift+Scroll: horizontal &bull; Ctrl+Scroll: zoom &bull; Drag: pan
        </div>
      )}

      {/* Hover tooltip */}
      {hoveredNote && mousePos && (
        <div
          className="fixed z-50 pointer-events-none px-3 py-2 rounded-lg text-xs font-mono"
          style={{
            left: mousePos.x + 14,
            top: mousePos.y - 60,
            backgroundColor: 'rgba(0,0,0,0.94)',
            border: '1px solid rgba(34,197,94,0.4)',
            color: '#fff',
            boxShadow: '0 4px 20px rgba(0,0,0,0.7)',
            backdropFilter: 'blur(8px)',
          }}
        >
          <div className="flex items-center gap-2 mb-1">
            <span className="text-green-400 font-bold text-sm">
              {midiPitchToName(hoveredNote.pitchMidi)}
            </span>
            <span className="text-white/35">
              MIDI {hoveredNote.pitchMidi}
            </span>
          </div>
          <div className="text-white/55">
            Start: {hoveredNote.startTimeSeconds.toFixed(3)}s
          </div>
          <div className="text-white/55">
            Duration: {(hoveredNote.durationSeconds * 1000).toFixed(0)}ms
          </div>
          <div className="text-white/55">
            Velocity: {Math.round(hoveredNote.amplitude * 127)}
          </div>
          {hoveredNote.pitchBends && hoveredNote.pitchBends.length > 0 && (
            <div className="text-white/40 mt-0.5 text-[10px]">
              Pitch bend: {hoveredNote.pitchBends.length} points
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Helpers ───

function drawPianoKeys(
  ctx: CanvasRenderingContext2D,
  minPitch: number,
  pitchRange: number,
  nh: number,
  sy: number,
  canvasW: number,
  canvasH: number,
  notes: DetectedNote[],
  currentTime: number
) {
  // Find currently active pitches
  const activePitches = new Set<number>();
  for (const note of notes) {
    if (currentTime >= note.startTimeSeconds && currentTime <= note.startTimeSeconds + note.durationSeconds) {
      activePitches.add(note.pitchMidi);
    }
  }

  ctx.fillStyle = '#0a0a0a';
  ctx.fillRect(0, 0, PIANO_KEY_WIDTH, canvasH);

  ctx.save();
  ctx.beginPath();
  ctx.rect(0, HEADER_HEIGHT, PIANO_KEY_WIDTH, canvasH - HEADER_HEIGHT);
  ctx.clip();

  const maxPitch = minPitch + pitchRange - 1;
  for (let i = 0; i < pitchRange; i++) {
    const pitch = maxPitch - i;
    const y = HEADER_HEIGHT + i * nh - sy;
    if (y + nh < HEADER_HEIGHT || y > canvasH) continue;

    const noteName = midiPitchToName(pitch);
    const isSharp = noteName.includes('#');
    const isC = noteName.startsWith('C') && !noteName.includes('#');
    const isActive = activePitches.has(pitch);

    if (isActive) {
      // Active key — glowing green
      ctx.fillStyle = 'rgba(34, 197, 94, 0.25)';
      ctx.fillRect(0, y, PIANO_KEY_WIDTH, nh);
      ctx.fillStyle = 'rgba(34, 197, 94, 0.5)';
      ctx.fillRect(0, y, 6, nh);
    } else if (isSharp) {
      ctx.fillStyle = '#111';
      ctx.fillRect(0, y, PIANO_KEY_WIDTH, nh);
      ctx.fillStyle = '#080808';
      ctx.fillRect(0, y, 8, nh);
    } else {
      ctx.fillStyle = '#191919';
      ctx.fillRect(0, y, PIANO_KEY_WIDTH, nh);
      ctx.fillStyle = isC ? 'rgba(34, 197, 94, 0.3)' : '#252525';
      ctx.fillRect(0, y, 5, nh);
    }

    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(0, y + nh);
    ctx.lineTo(PIANO_KEY_WIDTH, y + nh);
    ctx.stroke();

    const fontSize = Math.min(12, nh - 2);
    if (fontSize >= 7) {
      ctx.font = `${isC || isActive ? 'bold ' : ''}${fontSize}px system-ui, sans-serif`;
      ctx.textAlign = 'right';
      ctx.fillStyle = isActive
        ? 'rgba(74, 222, 155, 1)'
        : isSharp
          ? 'rgba(255,255,255,0.25)'
          : isC
            ? 'rgba(34, 197, 94, 0.8)'
            : 'rgba(255,255,255,0.45)';
      ctx.fillText(noteName, PIANO_KEY_WIDTH - 10, y + nh - 3);
    }
  }

  ctx.restore();

  ctx.strokeStyle = 'rgba(255,255,255,0.1)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(PIANO_KEY_WIDTH, 0);
  ctx.lineTo(PIANO_KEY_WIDTH, canvasH);
  ctx.stroke();

  ctx.fillStyle = '#0c0c0c';
  ctx.fillRect(0, 0, PIANO_KEY_WIDTH, HEADER_HEIGHT);
  ctx.fillStyle = 'rgba(255,255,255,0.3)';
  ctx.font = 'bold 9px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('NOTE', PIANO_KEY_WIDTH / 2, 21);
}

function drawMinimap(
  ctx: CanvasRenderingContext2D,
  notesArr: DetectedNote[],
  dur: number,
  sx: number,
  rollW: number,
  currentPps: number,
  canvasW: number,
  canvasH: number,
  rollH: number,
  minPitch: number,
  maxPitch: number,
  pitchRange: number,
  nh: number,
  sy: number,
  currentTime: number
) {
  const mapW = Math.min(200, rollW * 0.3);
  const mapH = 36;
  const mapX = PIANO_KEY_WIDTH + rollW - mapW - 8;
  const mapY = canvasH - mapH - 8;

  ctx.fillStyle = 'rgba(0,0,0,0.75)';
  ctx.beginPath();
  ctx.roundRect(mapX, mapY, mapW, mapH, 5);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.lineWidth = 0.5;
  ctx.beginPath();
  ctx.roundRect(mapX, mapY, mapW, mapH, 5);
  ctx.stroke();

  const ppsMini = mapW / Math.max(dur, 1);
  const pitchMiniH = mapH / pitchRange;
  for (const note of notesArr) {
    const nx = mapX + note.startTimeSeconds * ppsMini;
    const nw = Math.max(1, note.durationSeconds * ppsMini);
    const ny = mapY + (maxPitch - note.pitchMidi) * pitchMiniH;
    ctx.fillStyle = 'rgba(34, 197, 94, 0.45)';
    ctx.fillRect(nx, ny, nw, Math.max(1, pitchMiniH));
  }

  // Playhead on minimap
  if (currentTime > 0) {
    const phX = mapX + (currentTime / Math.max(dur, 1)) * mapW;
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.fillRect(phX - 0.5, mapY, 1, mapH);
  }

  const vpX = mapX + (sx / Math.max(dur, 1)) * mapW;
  const vpW = Math.max(4, (rollW / currentPps / Math.max(dur, 1)) * mapW);
  ctx.strokeStyle = 'rgba(255,255,255,0.5)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.roundRect(vpX, mapY, vpW, mapH, 2);
  ctx.stroke();
}

function getTimeStep(pps: number): number {
  const minPixelStep = 60;
  const minTimeStep = minPixelStep / pps;
  const steps = [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60];
  for (const s of steps) {
    if (s >= minTimeStep) return s;
  }
  return 60;
}

function formatTime(t: number): string {
  if (t < 10) return t.toFixed(1) + 's';
  return Math.round(t) + 's';
}

function formatTimeCompact(t: number): string {
  const mins = Math.floor(t / 60);
  const secs = t % 60;
  return `${mins}:${secs.toFixed(1).padStart(4, '0')}`;
}
