'use client';

import React, { useRef, useEffect, useCallback, useState } from 'react';
import { DetectedNote, midiPitchToName } from '@/lib/audio-engine';

interface PianoRollVisualizerProps {
  notes: DetectedNote[];
  duration: number;
  currentTime: number;
  isPlaying: boolean;
  accentColor?: string;
}

// Layout constants
const PIANO_KEY_WIDTH = 56;
const HEADER_HEIGHT = 32;
const MIN_NOTE_HEIGHT = 10;
const MAX_NOTE_HEIGHT = 32;
const DEFAULT_NOTE_HEIGHT = 18;
const DEFAULT_PPS = 80;
const MIN_PPS = 10;
const MAX_PPS = 800;

// Smooth interpolation factor (0 = no movement, 1 = instant)
const LERP = 0.18;

// Color palette for amplitude levels
const AMP_COLORS = [
  'rgba(34, 197, 94, 0.4)',
  'rgba(34, 197, 94, 0.55)',
  'rgba(34, 197, 94, 0.7)',
  'rgba(34, 197, 94, 0.85)',
  'rgba(52, 211, 153, 1)',
];

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function PianoRollVisualizer({
  notes,
  duration,
  currentTime,
  isPlaying,
  accentColor = '#22c55e',
}: PianoRollVisualizerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number>(0);
  const zoomTextRef = useRef<HTMLSpanElement>(null);

  // ── All view state in refs for 60fps updates without React re-renders ──
  const viewRef = useRef({
    // Target values (where we want to be)
    targetScrollX: 0,
    targetScrollY: 0,
    targetPps: DEFAULT_PPS,
    targetNoteHeight: DEFAULT_NOTE_HEIGHT,

    // Current interpolated values (what we render)
    scrollX: 0,
    scrollY: 0,
    pps: DEFAULT_PPS,
    noteHeight: DEFAULT_NOTE_HEIGHT,

    // Canvas size cache
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

  // Hover state (kept as React state since it affects DOM tooltip)
  const [hoveredNote, setHoveredNote] = useState<DetectedNote | null>(null);
  const [mousePos, setMousePos] = useState<{ x: number; y: number } | null>(null);
  const notesLayoutRef = useRef<{ note: DetectedNote; x: number; y: number; w: number; h: number }[]>([]);

  // Pitch range cache (recalculated when notes change)
  const pitchRangeRef = useRef({ min: 0, max: 127, range: 128 });

  // ── Calculate pitch range when notes change ──
  useEffect(() => {
    if (notes.length === 0) return;
    const pitches = notes.map(n => n.pitchMidi);
    const minPitch = Math.max(0, Math.min(...pitches) - 2);
    const maxPitch = Math.min(127, Math.max(...pitches) + 2);
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
    const { min: minPitch, range: pitchRange } = pitchRangeRef.current;

    // Fit vertically
    const fitNh = Math.max(MIN_NOTE_HEIGHT, Math.min(MAX_NOTE_HEIGHT, rollHeight / pitchRange));
    const totalH = pitchRange * fitNh;
    const yOffset = Math.max(0, (totalH - rollHeight) / 2);

    // Fit horizontally
    const fitPps = rollWidth / Math.max(duration, 1);
    const usePps = (fitPps >= MIN_PPS && fitPps <= MAX_PPS) ? fitPps : DEFAULT_PPS;

    const v = viewRef.current;
    v.targetNoteHeight = fitNh;
    v.targetScrollY = yOffset;
    v.targetPps = usePps;
    v.targetScrollX = 0;
    // Snap immediately on first load
    v.noteHeight = fitNh;
    v.scrollY = yOffset;
    v.pps = usePps;
    v.scrollX = 0;
  }, [notes, duration]);

  // ─── Drawing (reads from refs, never triggers re-render) ───
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

    const dpr = window.devicePixelRatio || 1;
    const rect = container.getBoundingClientRect();
    const width = rect.width;
    const height = rect.height;

    // Only resize canvas when needed (avoids clearing canvas unnecessarily)
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
    ctx.fillStyle = '#080808';
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

    // ─── Header (time ruler) ───
    ctx.fillStyle = '#111111';
    ctx.fillRect(PIANO_KEY_WIDTH, 0, rollWidth, HEADER_HEIGHT);
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(PIANO_KEY_WIDTH, HEADER_HEIGHT);
    ctx.lineTo(width, HEADER_HEIGHT);
    ctx.stroke();

    const timeStep = getTimeStep(pps);
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.font = '10px system-ui, sans-serif';
    ctx.textAlign = 'center';
    const startT = Math.floor(visibleStartTime / timeStep) * timeStep;
    for (let t = startT; t <= visibleEndTime + timeStep; t += timeStep) {
      if (t < 0) continue;
      const x = PIANO_KEY_WIDTH + (t - scrollX) * pps;
      if (x < PIANO_KEY_WIDTH - 20 || x > width + 20) continue;
      ctx.fillText(formatTime(t), x, 18);
      ctx.strokeStyle = 'rgba(255,255,255,0.06)';
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.moveTo(x, HEADER_HEIGHT);
      ctx.lineTo(x, height);
      ctx.stroke();
    }

    // ─── Clip the roll area ───
    ctx.save();
    ctx.beginPath();
    ctx.rect(PIANO_KEY_WIDTH, HEADER_HEIGHT, rollWidth, rollHeight);
    ctx.clip();

    const noteLayouts: { note: DetectedNote; x: number; y: number; w: number; h: number }[] = [];

    // ─── Grid rows ───
    for (let i = 0; i < pitchRange; i++) {
      const pitch = minPitch + i;
      const y = HEADER_HEIGHT + i * noteHeight - scrollY;
      if (y + noteHeight < HEADER_HEIGHT || y > height) continue;

      const noteName = midiPitchToName(pitch);
      const isSharp = noteName.includes('#');
      const isC = noteName.startsWith('C') && !noteName.includes('#');

      if (isSharp) {
        ctx.fillStyle = 'rgba(0,0,0,0.35)';
      } else {
        ctx.fillStyle = 'rgba(255,255,255,0.02)';
      }
      ctx.fillRect(PIANO_KEY_WIDTH, y, rollWidth, noteHeight);

      if (isC) {
        ctx.strokeStyle = 'rgba(255,255,255,0.1)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(PIANO_KEY_WIDTH, y);
        ctx.lineTo(width, y);
        ctx.stroke();
      } else {
        ctx.strokeStyle = 'rgba(255,255,255,0.03)';
        ctx.lineWidth = 0.5;
        ctx.beginPath();
        ctx.moveTo(PIANO_KEY_WIDTH, y + noteHeight);
        ctx.lineTo(width, y + noteHeight);
        ctx.stroke();
      }
    }

    // ─── Detected notes ───
    for (const note of notesArr) {
      const x = PIANO_KEY_WIDTH + (note.startTimeSeconds - scrollX) * pps;
      const nw = Math.max(4, note.durationSeconds * pps);
      const y = HEADER_HEIGHT + (note.pitchMidi - minPitch) * noteHeight - scrollY;

      if (x + nw < PIANO_KEY_WIDTH || x > width) continue;
      if (y + noteHeight < HEADER_HEIGHT || y > height) continue;

      const noteName = midiPitchToName(note.pitchMidi);
      noteLayouts.push({ note, x, y, w: nw, h: noteHeight });

      const ampLevel = Math.min(4, Math.floor(note.amplitude * 5));
      const fillColor = accentColor === '#22c55e' ? AMP_COLORS[ampLevel] : accentColor;
      const radius = Math.min(4, noteHeight / 3);

      // Shadow
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.beginPath();
      ctx.roundRect(x + 1, y + 2, nw, noteHeight - 1, radius);
      ctx.fill();

      // Body
      ctx.fillStyle = fillColor;
      ctx.beginPath();
      ctx.roundRect(x, y + 1, nw, noteHeight - 2, radius);
      ctx.fill();

      // Highlight
      const hg = ctx.createLinearGradient(x, y + 1, x, y + noteHeight - 2);
      hg.addColorStop(0, 'rgba(255,255,255,0.22)');
      hg.addColorStop(0.3, 'rgba(255,255,255,0.06)');
      hg.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = hg;
      ctx.beginPath();
      ctx.roundRect(x, y + 1, nw, noteHeight - 2, radius);
      ctx.fill();

      // ─── Note label ───
      const labelFontSize = Math.min(11, noteHeight - 3);
      if (nw > 24 && labelFontSize >= 6) {
        ctx.font = `bold ${labelFontSize}px system-ui, sans-serif`;
        ctx.textAlign = 'left';
        ctx.fillStyle = 'rgba(0,0,0,0.65)';
        ctx.fillText(noteName, x + 5, y + noteHeight - 4);
        ctx.fillStyle = 'rgba(255,255,255,0.92)';
        ctx.fillText(noteName, x + 4, y + noteHeight - 5);
      } else if (labelFontSize >= 6 && nw > 8) {
        const sf = Math.min(9, labelFontSize);
        ctx.font = `bold ${sf}px system-ui, sans-serif`;
        ctx.textAlign = 'center';
        const lw = ctx.measureText(noteName).width + 6;
        const lx = x + nw / 2;
        const ly = y - 2;
        ctx.fillStyle = 'rgba(0,0,0,0.75)';
        ctx.beginPath();
        ctx.roundRect(lx - lw / 2, ly - sf - 1, lw, sf + 3, 3);
        ctx.fill();
        ctx.fillStyle = 'rgba(34, 197, 94, 0.95)';
        ctx.fillText(noteName, lx, ly - 2);
      }
    }

    notesLayoutRef.current = noteLayouts;

    // ─── Playhead ───
    if (currentTime > 0) {
      const px = PIANO_KEY_WIDTH + (currentTime - scrollX) * pps;
      if (px >= PIANO_KEY_WIDTH && px <= width) {
        const grad = ctx.createLinearGradient(px - 25, 0, px + 25, 0);
        grad.addColorStop(0, 'rgba(255,255,255,0)');
        grad.addColorStop(0.5, 'rgba(255,255,255,0.07)');
        grad.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = grad;
        ctx.fillRect(px - 25, HEADER_HEIGHT, 50, rollHeight);

        ctx.fillStyle = 'rgba(255,255,255,0.9)';
        ctx.fillRect(px - 0.5, HEADER_HEIGHT, 1.5, rollHeight);

        ctx.fillStyle = 'rgba(255,255,255,0.95)';
        ctx.beginPath();
        ctx.moveTo(px - 5, HEADER_HEIGHT);
        ctx.lineTo(px + 5, HEADER_HEIGHT);
        ctx.lineTo(px, HEADER_HEIGHT + 7);
        ctx.closePath();
        ctx.fill();
      }
    }

    ctx.restore();

    // ─── Piano keyboard sidebar ───
    drawPianoKeys(ctx, minPitch, pitchRange, noteHeight, scrollY, width, height);

    // Border
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 1;
    ctx.strokeRect(0, 0, width, height);

    // ─── Mini-map ───
    drawMinimap(ctx, notesArr, dur, scrollX, rollWidth, pps, width, height, rollHeight, minPitch, maxPitch, pitchRange, noteHeight, scrollY);

  }, [notes, duration, currentTime, accentColor]);

  // ─── Smooth animation loop (always running) ───
  useEffect(() => {
    let running = true;

    const tick = () => {
      if (!running) return;

      const v = viewRef.current;

      // Interpolate toward targets
      const dx = v.targetScrollX - v.scrollX;
      const dy = v.targetScrollY - v.scrollY;
      const dp = v.targetPps - v.pps;
      const dn = v.targetNoteHeight - v.noteHeight;

      // Snap if close enough (avoids infinite micro-movement)
      const threshold = 0.01;
      v.scrollX = Math.abs(dx) < threshold ? v.targetScrollX : lerp(v.scrollX, v.targetScrollX, LERP);
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
  }, [drawPianoRoll]);

  // ─── Wheel handler (registered as non-passive for preventDefault) ───
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();

      const v = viewRef.current;
      const { pps } = v;

      if (e.ctrlKey || e.metaKey) {
        // ── Zoom ──
        if (e.shiftKey) {
          // Vertical zoom
          const delta = -e.deltaY * 0.01;
          v.targetNoteHeight = Math.max(MIN_NOTE_HEIGHT, Math.min(MAX_NOTE_HEIGHT, v.targetNoteHeight * (1 + delta)));
        } else {
          // Horizontal zoom towards cursor
          const rect = container.getBoundingClientRect();
          const mouseX = e.clientX - rect.left - PIANO_KEY_WIDTH;
          const timeAtCursor = v.targetScrollX + mouseX / v.targetPps;

          // Use deltaY as continuous zoom factor
          const zoomDelta = -e.deltaY * 0.002;
          const factor = Math.exp(zoomDelta); // exponential zoom = smooth
          const newPps = Math.max(MIN_PPS, Math.min(MAX_PPS, v.targetPps * factor));

          // Keep cursor position stable
          v.targetScrollX = Math.max(0, timeAtCursor - mouseX / newPps);
          v.targetPps = newPps;
        }
      } else if (e.shiftKey) {
        // ── Horizontal scroll ──
        const delta = e.deltaY / pps;
        const maxScrollX = Math.max(0, duration - (container.getBoundingClientRect().width - PIANO_KEY_WIDTH) / v.targetPps);
        v.targetScrollX = Math.max(0, Math.min(maxScrollX, v.targetScrollX + delta));
      } else {
        // ── Vertical scroll ──
        // Use deltaY with pixel mode normalization
        let dy = e.deltaY;
        if (e.deltaMode === 1) dy *= 40; // lines
        if (e.deltaMode === 2) dy *= 800; // pages
        v.targetScrollY = Math.max(0, v.targetScrollY + dy * 0.4);
      }
    };

    // Register as non-passive so preventDefault works
    container.addEventListener('wheel', onWheel, { passive: false });
    return () => container.removeEventListener('wheel', onWheel);
  }, [duration]);

  // ─── Drag to pan ───
  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    if (e.clientX - rect.left < PIANO_KEY_WIDTH) return;

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

  // ─── Touch support (pinch zoom + drag) ───
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let lastTouches: TouchList | null = null;
    let lastPanPos: { x: number; y: number } | null = null;

    const onTouchStart = (e: TouchEvent) => {
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

      if (e.touches.length === 1 && lastPanPos) {
        // Single finger pan
        const dx = e.touches[0].clientX - lastPanPos.x;
        const dy = e.touches[0].clientY - lastPanPos.y;
        v.targetScrollX = Math.max(0, v.targetScrollX - dx / v.pps);
        v.targetScrollY = Math.max(0, v.targetScrollY - dy);
        lastPanPos = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      }

      if (e.touches.length === 2 && lastTouches) {
        // Pinch zoom
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
            top: mousePos.y - 50,
            backgroundColor: 'rgba(0,0,0,0.92)',
            border: '1px solid rgba(34,197,94,0.4)',
            color: '#fff',
            boxShadow: '0 4px 16px rgba(0,0,0,0.6)',
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
            Start: {hoveredNote.startTimeSeconds.toFixed(2)}s
          </div>
          <div className="text-white/55">
            Duration: {(hoveredNote.durationSeconds * 1000).toFixed(0)}ms
          </div>
          <div className="text-white/55">
            Velocity: {Math.round(hoveredNote.amplitude * 127)}
          </div>
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
  canvasH: number
) {
  ctx.fillStyle = '#0c0c0c';
  ctx.fillRect(0, 0, PIANO_KEY_WIDTH, canvasH);

  ctx.save();
  ctx.beginPath();
  ctx.rect(0, HEADER_HEIGHT, PIANO_KEY_WIDTH, canvasH - HEADER_HEIGHT);
  ctx.clip();

  for (let i = 0; i < pitchRange; i++) {
    const pitch = minPitch + i;
    const y = HEADER_HEIGHT + i * nh - sy;
    if (y + nh < HEADER_HEIGHT || y > canvasH) continue;

    const noteName = midiPitchToName(pitch);
    const isSharp = noteName.includes('#');
    const isC = noteName.startsWith('C') && !noteName.includes('#');

    if (isSharp) {
      ctx.fillStyle = '#141414';
      ctx.fillRect(0, y, PIANO_KEY_WIDTH, nh);
      ctx.fillStyle = '#0a0a0a';
      ctx.fillRect(0, y, 8, nh);
    } else {
      ctx.fillStyle = '#1c1c1c';
      ctx.fillRect(0, y, PIANO_KEY_WIDTH, nh);
      ctx.fillStyle = isC ? 'rgba(34, 197, 94, 0.35)' : '#282828';
      ctx.fillRect(0, y, 5, nh);
    }

    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(0, y + nh);
    ctx.lineTo(PIANO_KEY_WIDTH, y + nh);
    ctx.stroke();

    const fontSize = Math.min(12, nh - 2);
    if (fontSize >= 7) {
      ctx.font = `${isC ? 'bold ' : ''}${fontSize}px system-ui, sans-serif`;
      ctx.textAlign = 'right';
      ctx.fillStyle = isSharp
        ? 'rgba(255,255,255,0.3)'
        : isC
          ? 'rgba(34, 197, 94, 0.85)'
          : 'rgba(255,255,255,0.5)';
      ctx.fillText(noteName, PIANO_KEY_WIDTH - 8, y + nh - 3);
    }
  }

  ctx.restore();

  ctx.strokeStyle = 'rgba(255,255,255,0.12)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(PIANO_KEY_WIDTH, 0);
  ctx.lineTo(PIANO_KEY_WIDTH, canvasH);
  ctx.stroke();

  ctx.fillStyle = '#0e0e0e';
  ctx.fillRect(0, 0, PIANO_KEY_WIDTH, HEADER_HEIGHT);
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  ctx.font = 'bold 9px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('NOTE', PIANO_KEY_WIDTH / 2, 19);
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
  sy: number
) {
  const mapW = Math.min(200, rollW * 0.3);
  const mapH = 32;
  const mapX = PIANO_KEY_WIDTH + rollW - mapW - 8;
  const mapY = canvasH - mapH - 8;

  ctx.fillStyle = 'rgba(0,0,0,0.7)';
  ctx.beginPath();
  ctx.roundRect(mapX, mapY, mapW, mapH, 4);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.1)';
  ctx.lineWidth = 0.5;
  ctx.beginPath();
  ctx.roundRect(mapX, mapY, mapW, mapH, 4);
  ctx.stroke();

  const ppsMini = mapW / Math.max(dur, 1);
  const pitchMiniH = mapH / pitchRange;
  for (const note of notesArr) {
    const nx = mapX + note.startTimeSeconds * ppsMini;
    const nw = Math.max(1, note.durationSeconds * ppsMini);
    const ny = mapY + (maxPitch - note.pitchMidi) * pitchMiniH;
    ctx.fillStyle = 'rgba(34, 197, 94, 0.5)';
    ctx.fillRect(nx, ny, nw, Math.max(1, pitchMiniH));
  }

  const vpX = mapX + (sx / Math.max(dur, 1)) * mapW;
  const vpW = Math.max(4, (rollW / currentPps / Math.max(dur, 1)) * mapW);
  ctx.strokeStyle = 'rgba(255,255,255,0.6)';
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
