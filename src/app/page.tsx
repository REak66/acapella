'use client';

import React, { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Download, RotateCcw, Music2, Zap, BarChart2, Waves, Settings, Sliders, Check, HelpCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { DropZone } from '@/components/acapella/drop-zone';
import { WaveformVisualizer } from '@/components/acapella/waveform-visualizer';
import { PianoRollVisualizer } from '@/components/acapella/piano-roll-visualizer';
import { AudioPlayer } from '@/components/acapella/audio-player';
import { ProcessingStatus } from '@/components/acapella/processing-status';
import { NoteStats } from '@/components/acapella/note-stats';
import {
  processAudioToMidi,
  downloadMidiFile,
  runModelAnalysis,
  extractNotesFromAnalysis,
  detectBPM,
  type DetectedNote,
  type ProcessingProgress,
  type TranscriptionOptions,
  type ModelAnalysis,
  TRANSCRIPTION_PRESETS,
} from '@/lib/audio-engine';

export default function Home() {
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [audioBuffer, setAudioBuffer] = useState<AudioBuffer | null>(null);
  const [modelAnalysis, setModelAnalysis] = useState<ModelAnalysis | null>(null);
  const [notes, setNotes] = useState<DetectedNote[]>([]);
  const [duration, setDuration] = useState(0);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState<ProcessingProgress | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [activeTab, setActiveTab] = useState('waveform');
  const [fileName, setFileName] = useState('');
  const [bpm, setBpm] = useState(120);

  // Transcription parameters with 'acapella' preset as default for optimal vocal performance
  const [preset, setPreset] = useState<string>('acapella');
  const [onsetThresh, setOnsetThresh] = useState(0.35);
  const [frameThresh, setFrameThresh] = useState(0.25);
  const [minNoteLen, setMinNoteLen] = useState(6);
  const [energyTolerance, setEnergyTolerance] = useState(1.5);
  const [melodiaTrick, setMelodiaTrick] = useState(true);
  const [minAmplitude, setMinAmplitude] = useState(0.03);
  const [minDurationSeconds, setMinDurationSeconds] = useState(0.04);

  // Apply new settings to cached model analysis instantly
  const handleSettingsChange = useCallback(async (newOptions: Partial<TranscriptionOptions>) => {
    const updatedOptions: TranscriptionOptions = {
      onsetThresh: newOptions.onsetThresh ?? onsetThresh,
      frameThresh: newOptions.frameThresh ?? frameThresh,
      minNoteLen: newOptions.minNoteLen ?? minNoteLen,
      energyTolerance: newOptions.energyTolerance ?? energyTolerance,
      melodiaTrick: newOptions.melodiaTrick !== undefined ? newOptions.melodiaTrick : melodiaTrick,
      minAmplitude: newOptions.minAmplitude ?? minAmplitude,
      minDurationSeconds: newOptions.minDurationSeconds ?? minDurationSeconds,
    };

    if (newOptions.onsetThresh !== undefined) setOnsetThresh(newOptions.onsetThresh);
    if (newOptions.frameThresh !== undefined) setFrameThresh(newOptions.frameThresh);
    if (newOptions.minNoteLen !== undefined) setMinNoteLen(newOptions.minNoteLen);
    if (newOptions.energyTolerance !== undefined) setEnergyTolerance(newOptions.energyTolerance);
    if (newOptions.melodiaTrick !== undefined) setMelodiaTrick(newOptions.melodiaTrick);
    if (newOptions.minAmplitude !== undefined) setMinAmplitude(newOptions.minAmplitude);
    if (newOptions.minDurationSeconds !== undefined) setMinDurationSeconds(newOptions.minDurationSeconds);

    if (modelAnalysis) {
      try {
        const extractedNotes = await extractNotesFromAnalysis(modelAnalysis, updatedOptions);
        setNotes(extractedNotes);
        setBpm(detectBPM(extractedNotes) || 120);
      } catch (err) {
        console.error('Error re-processing notes:', err);
      }
    }
  }, [modelAnalysis, onsetThresh, frameThresh, minNoteLen, energyTolerance, melodiaTrick, minAmplitude, minDurationSeconds]);

  const applyPreset = useCallback((presetName: string) => {
    const selectedPreset = TRANSCRIPTION_PRESETS[presetName];
    if (selectedPreset) {
      setPreset(presetName);
      handleSettingsChange(selectedPreset);
    }
  }, [handleSettingsChange]);

  const handleFileSelected = useCallback(async (file: File) => {
    setAudioFile(file);
    setFileName(file.name);
    setNotes([]);
    setAudioBuffer(null);
    setModelAnalysis(null);
    setCurrentTime(0);
    setIsPlaying(false);
    setIsProcessing(true);

    try {
      // Step 1: Run model analysis (slow part)
      const analysis = await runModelAnalysis(file, (p) => {
        setProgress(p);
      });
      setModelAnalysis(analysis);
      setAudioBuffer(analysis.audioBuffer);
      setDuration(analysis.duration);

      // Step 2: Extract notes with current parameters
      setProgress({
        stage: 'postprocessing',
        percent: 85,
        message: 'Extracting note events...',
      });

      const currentOptions: TranscriptionOptions = {
        onsetThresh,
        frameThresh,
        minNoteLen,
        energyTolerance,
        melodiaTrick,
        minAmplitude,
        minDurationSeconds,
      };

      const extractedNotes = await extractNotesFromAnalysis(analysis, currentOptions);
      setNotes(extractedNotes);
      setBpm(detectBPM(extractedNotes) || 120);

      setProgress({
        stage: 'done',
        percent: 100,
        message: `Done! Detected ${extractedNotes.length} notes`,
      });
    } catch (error) {
      console.error('Processing failed:', error);
      setProgress({
        stage: 'done',
        percent: 0,
        message: `Error: ${error instanceof Error ? error.message : 'Processing failed'}`,
      });
    } finally {
      setIsProcessing(false);
    }
  }, [onsetThresh, frameThresh, minNoteLen, energyTolerance, melodiaTrick, minAmplitude, minDurationSeconds]);

  const handleDownload = useCallback(async () => {
    if (notes.length > 0) {
      await downloadMidiFile(notes, fileName || 'output');
    }
  }, [notes, fileName]);

  const handleReset = useCallback(() => {
    setAudioFile(null);
    setAudioBuffer(null);
    setModelAnalysis(null);
    setNotes([]);
    setDuration(0);
    setProgress(null);
    setCurrentTime(0);
    setIsPlaying(false);
    setFileName('');
    setIsProcessing(false);
    setBpm(120);
  }, []);

  const hasResults = notes.length > 0 && audioBuffer !== null;

  return (
    <div className="min-h-screen text-white flex flex-col" style={{ backgroundColor: '#0a0a0a' }}>
      {/* Header */}
      <header className="border-b border-white/[0.06] backdrop-blur-xl sticky top-0 z-50" style={{ backgroundColor: 'rgba(10,10,10,0.8)' }}>
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="relative">
              <Music2 className="w-6 h-6 text-green-400" />
              <div className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-green-400 rounded-full animate-pulse" />
            </div>
            <div>
              <h1 className="text-sm font-bold tracking-tight">
                Acapella to MIDI
              </h1>
              <p className="text-[10px] text-white/30 -mt-0.5">
                Powered by REakRMX
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {hasResults && (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-white/50 hover:text-white hover:bg-white/10 gap-1.5 text-xs"
                  onClick={handleReset}
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  New
                </Button>
                <Button
                  size="sm"
                  className="bg-green-500 hover:bg-green-600 text-black font-semibold gap-1.5 text-xs"
                  onClick={handleDownload}
                >
                  <Download className="w-3.5 h-3.5" />
                  Export MIDI
                </Button>
              </>
            )}
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 max-w-6xl mx-auto w-full px-4 sm:px-6 py-6">
        <AnimatePresence mode="wait">
          {!audioFile ? (
            /* Upload State */
            <div
              key="upload"
              className="flex flex-col items-center justify-center min-h-[calc(100vh-8rem)]"
            >
              <div className="text-center mb-8 max-w-lg">
                <h2 className="text-3xl sm:text-4xl font-bold mb-3 bg-gradient-to-r from-green-400 via-emerald-300 to-green-400 bg-clip-text text-transparent">
                  Transform Voice to MIDI
                </h2>
                <p className="text-white/40 text-base leading-relaxed">
                  Upload an acapella recording and our AI will detect every note,
                  pitch bend, and timing — then export a perfect MIDI file.
                </p>
              </div>

              <div className="w-full max-w-xl">
                <DropZone onFileSelected={handleFileSelected} isProcessing={isProcessing} />
              </div>

              <div className="mt-10 grid grid-cols-3 gap-6 max-w-md">
                {[
                  { icon: Zap, label: 'AI-Powered', desc: 'Neural network pitch detection' },
                  { icon: Waves, label: 'Precise', desc: 'Pitch bend & vibrato capture' },
                  { icon: BarChart2, label: 'Visual', desc: 'Waveform & piano roll views' },
                ].map(({ icon: Icon, label, desc }) => (
                  <div key={label} className="text-center">
                    <Icon className="w-5 h-5 text-green-400/50 mx-auto mb-1.5" />
                    <p className="text-xs font-medium text-white/60">{label}</p>
                    <p className="text-[10px] text-white/25 mt-0.5">{desc}</p>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            /* Results State */
            <div key="results" className="space-y-4">
              {/* File info bar */}
              <div className="flex items-center justify-between bg-white/[0.03] rounded-lg px-4 py-2.5 border border-white/[0.06]">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-8 h-8 rounded-md bg-green-400/10 flex items-center justify-center flex-shrink-0">
                    <Music2 className="w-4 h-4 text-green-400" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-white/80 truncate">{fileName}</p>
                    <p className="text-[11px] text-white/30">
                      {duration.toFixed(1)}s &bull; {notes.length} notes detected
                    </p>
                  </div>
                </div>

                {hasResults && (
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-white/50 hover:text-white hover:bg-white/10 gap-1.5 h-8 text-xs"
                      onClick={handleReset}
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                    </Button>
                    <Button
                      size="sm"
                      className="bg-green-500 hover:bg-green-600 text-black font-semibold gap-1.5 h-8 text-xs"
                      onClick={handleDownload}
                    >
                      <Download className="w-3.5 h-3.5" />
                      MIDI
                    </Button>
                  </div>
                )}
              </div>

              {/* Processing status */}
              {isProcessing && progress && (
                <div className="bg-white/[0.02] rounded-lg px-4 py-3 border border-white/[0.06]">
                  <ProcessingStatus progress={progress} />
                </div>
              )}

              {/* Transcription Settings Panel */}
              {hasResults && !isProcessing && (
                <div className="bg-white/[0.03] rounded-lg border border-white/[0.06] overflow-hidden">
                  <div className="px-4 py-2.5 border-b border-white/[0.06] bg-white/[0.01] flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Sliders className="w-4 h-4 text-green-400" />
                      <h3 className="text-xs font-semibold text-white/90">AI Transcription Settings</h3>
                    </div>
                    <span className="text-[10px] text-green-400/80 bg-green-500/10 px-2 py-0.5 rounded-full font-medium self-start sm:self-auto">
                      ⚡ Instant Tuning: Neural network outputs are cached
                    </span>
                  </div>
                  
                  <div className="p-4 space-y-4">
                    {/* Presets */}
                    <div>
                      <span className="text-[10px] text-white/40 block mb-2 font-medium uppercase tracking-wider">Transcription Presets</span>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                        {[
                          { id: 'acapella', label: 'Vocal / Acapella', desc: 'Captures subtle runs' },
                          { id: 'default', label: 'Balanced (Default)', desc: 'Standard vocal/solo' },
                          { id: 'polyphonic', label: 'Polyphonic', desc: 'Piano, guitar, chords' },
                          { id: 'strict', label: 'Clean / Strict', desc: 'Fewer noise fragments' }
                        ].map((p) => (
                          <button
                            key={p.id}
                            type="button"
                            onClick={() => applyPreset(p.id)}
                            className={`p-2 rounded-md border text-left transition-all relative ${
                              preset === p.id
                                ? 'border-green-500 bg-green-500/10 text-white shadow-[0_0_12px_rgba(34,197,94,0.15)]'
                                : 'border-white/[0.06] bg-white/[0.02] text-white/50 hover:bg-white/[0.04] hover:text-white/80'
                            }`}
                          >
                            <div className="text-xs font-semibold flex items-center justify-between">
                              {p.label}
                              {preset === p.id && <Check className="w-3.5 h-3.5 text-green-400" />}
                            </div>
                            <p className="text-[10px] text-white/30 mt-0.5 leading-tight">{p.desc}</p>
                          </button>
                        ))}
                      </div>
                    </div>

                    <details className="group">
                      <summary className="cursor-pointer flex items-center gap-1.5 text-xs text-white/40 hover:text-white/60 select-none">
                        <span>Show Detailed Parameters</span>
                        <span className="text-[10px] group-open:rotate-180 transition-transform">&#9660;</span>
                      </summary>
                      
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4 mt-4 pt-4 border-t border-white/[0.04]">
                        {/* Onset Threshold */}
                        <div className="space-y-1.5">
                          <div className="flex justify-between items-center">
                            <span className="text-xs font-medium text-white/70 flex items-center gap-1.5">
                              Onset Sensitivity
                              <span className="group/tooltip relative cursor-help">
                                <HelpCircle className="w-3.5 h-3.5 text-white/30 hover:text-white/50" />
                                <span className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 w-56 bg-black border border-white/10 text-[10px] text-white/70 p-2 rounded shadow-xl opacity-0 group-hover/tooltip:opacity-100 transition-opacity z-10 leading-normal normal-case font-normal">
                                  Controls note detection sensitivity. Lower thresholds capture soft/breathier note starts (ideal for acapella).
                                </span>
                              </span>
                            </span>
                            <span className="text-[11px] text-white/40 font-mono">{(1 - onsetThresh).toFixed(2)}</span>
                          </div>
                          <input
                            type="range"
                            min="0.15"
                            max="0.85"
                            step="0.05"
                            value={onsetThresh}
                            onChange={(e) => handleSettingsChange({ onsetThresh: parseFloat(e.target.value) })}
                            className="w-full h-1 bg-white/10 rounded-lg appearance-none cursor-pointer accent-green-400"
                          />
                        </div>

                        {/* Frame Threshold */}
                        <div className="space-y-1.5">
                          <div className="flex justify-between items-center">
                            <span className="text-xs font-medium text-white/70 flex items-center gap-1.5">
                              Sustain Hold (Frame Thresh)
                              <span className="group/tooltip relative cursor-help">
                                <HelpCircle className="w-3.5 h-3.5 text-white/30 hover:text-white/50" />
                                <span className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 w-56 bg-black border border-white/10 text-[10px] text-white/70 p-2 rounded shadow-xl opacity-0 group-hover/tooltip:opacity-100 transition-opacity z-10 leading-normal normal-case font-normal">
                                  Adjusts note sustain length. Lower thresholds keep notes sustained and connected; higher values split/truncate notes.
                                </span>
                              </span>
                            </span>
                            <span className="text-[11px] text-white/40 font-mono">{(1 - frameThresh).toFixed(2)}</span>
                          </div>
                          <input
                            type="range"
                            min="0.1"
                            max="0.8"
                            step="0.05"
                            value={frameThresh}
                            onChange={(e) => handleSettingsChange({ frameThresh: parseFloat(e.target.value) })}
                            className="w-full h-1 bg-white/10 rounded-lg appearance-none cursor-pointer accent-green-400"
                          />
                        </div>

                        {/* Min Note Length */}
                        <div className="space-y-1.5">
                          <div className="flex justify-between items-center">
                            <span className="text-xs font-medium text-white/70 flex items-center gap-1.5">
                              Minimum Note Length
                              <span className="group/tooltip relative cursor-help">
                                <HelpCircle className="w-3.5 h-3.5 text-white/30 hover:text-white/50" />
                                <span className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 w-56 bg-black border border-white/10 text-[10px] text-white/70 p-2 rounded shadow-xl opacity-0 group-hover/tooltip:opacity-100 transition-opacity z-10 leading-normal normal-case font-normal">
                                  Filters out short transient note fragments. Lower values capture fast vocal runs; higher values produce cleaner melodies.
                                </span>
                              </span>
                            </span>
                            <span className="text-[11px] text-white/40 font-mono">{minNoteLen} frames (~{Math.round(minNoteLen * 11.6)}ms)</span>
                          </div>
                          <input
                            type="range"
                            min="3"
                            max="25"
                            step="1"
                            value={minNoteLen}
                            onChange={(e) => handleSettingsChange({ minNoteLen: parseInt(e.target.value) })}
                            className="w-full h-1 bg-white/10 rounded-lg appearance-none cursor-pointer accent-green-400"
                          />
                        </div>

                        {/* Noise Gate / Min Amplitude */}
                        <div className="space-y-1.5">
                          <div className="flex justify-between items-center">
                            <span className="text-xs font-medium text-white/70 flex items-center gap-1.5">
                              Noise Gate (Amplitude Thresh)
                              <span className="group/tooltip relative cursor-help">
                                <HelpCircle className="w-3.5 h-3.5 text-white/30 hover:text-white/50" />
                                <span className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 w-56 bg-black border border-white/10 text-[10px] text-white/70 p-2 rounded shadow-xl opacity-0 group-hover/tooltip:opacity-100 transition-opacity z-10 leading-normal normal-case font-normal">
                                  Eliminates notes with amplitudes below this gate percentage. Filters background noise, breaths, or reverb.
                                </span>
                              </span>
                            </span>
                            <span className="text-[11px] text-white/40 font-mono">{(minAmplitude * 100).toFixed(0)}%</span>
                          </div>
                          <input
                            type="range"
                            min="0.01"
                            max="0.20"
                            step="0.01"
                            value={minAmplitude}
                            onChange={(e) => handleSettingsChange({ minAmplitude: parseFloat(e.target.value) })}
                            className="w-full h-1 bg-white/10 rounded-lg appearance-none cursor-pointer accent-green-400"
                          />
                        </div>

                        {/* Monophonic Vocal Mode */}
                        <div className="flex items-center justify-between p-2.5 rounded-lg border border-white/[0.04] bg-white/[0.01] md:col-span-2">
                          <div className="flex flex-col gap-0.5">
                            <span className="text-xs font-medium text-white/80 flex items-center gap-1.5">
                              Monophonic Vocal Tracking (Melodia Trick)
                              <span className="group/tooltip relative cursor-help">
                                <HelpCircle className="w-3.5 h-3.5 text-white/30 hover:text-white/50" />
                                <span className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 w-64 bg-black border border-white/10 text-[10px] text-white/70 p-2 rounded shadow-xl opacity-0 group-hover/tooltip:opacity-100 transition-opacity z-10 leading-normal normal-case font-normal">
                                  Enforces a single voice pitch line by selecting the most dominant vocal frequency contour, avoiding overlapping/harmonizing notes.
                                </span>
                              </span>
                            </span>
                            <span className="text-[10px] text-white/30">Restricts pitch detection to a single melodic stream (recommended for solo vocals)</span>
                          </div>
                          <button
                            type="button"
                            onClick={() => handleSettingsChange({ melodiaTrick: !melodiaTrick })}
                            className={`w-9 h-5 rounded-full transition-colors relative flex items-center flex-shrink-0 ${
                              melodiaTrick ? 'bg-green-500' : 'bg-white/10'
                            }`}
                          >
                            <div
                              className={`w-3.5 h-3.5 bg-black rounded-full shadow transition-transform absolute ${
                                melodiaTrick ? 'translate-x-5' : 'translate-x-0.5'
                              }`}
                            />
                          </button>
                        </div>
                      </div>
                    </details>
                  </div>
                </div>
              )}

              {/* Stats */}
              {hasResults && (
                <NoteStats notes={notes} duration={duration} bpm={bpm} />
              )}

              {/* Visualizations */}
              {hasResults && (
                <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
                  <TabsList className="bg-white/[0.05] border border-white/[0.06] h-9 p-1">
                    <TabsTrigger
                      value="waveform"
                      className="text-xs data-[state=active]:bg-green-500/20 data-[state=active]:text-green-400"
                    >
                      Waveform
                    </TabsTrigger>
                    <TabsTrigger
                      value="pianoroll"
                      className="text-xs data-[state=active]:bg-green-500/20 data-[state=active]:text-green-400"
                    >
                      Piano Roll
                    </TabsTrigger>
                    <TabsTrigger
                      value="split"
                      className="text-xs data-[state=active]:bg-green-500/20 data-[state=active]:text-green-400"
                    >
                      Split View
                    </TabsTrigger>
                  </TabsList>

                  <TabsContent value="waveform" className="mt-3">
                    <div className="rounded-lg border border-white/[0.06] overflow-hidden" style={{ backgroundColor: '#0f0f0f' }}>
                      <div className="h-48 sm:h-56">
                        <WaveformVisualizer
                          audioBuffer={audioBuffer}
                          currentTime={currentTime}
                          isPlaying={isPlaying}
                        />
                      </div>
                    </div>
                  </TabsContent>

                  <TabsContent value="pianoroll" className="mt-3">
                    <div className="rounded-lg border border-white/[0.06] overflow-hidden" style={{ backgroundColor: '#0f0f0f' }}>
                      <div className="h-[420px] sm:h-[520px]">
                        <PianoRollVisualizer
                          notes={notes}
                          duration={duration}
                          currentTime={currentTime}
                          isPlaying={isPlaying}
                          bpm={bpm}
                          audioBuffer={audioBuffer}
                        />
                      </div>
                    </div>
                  </TabsContent>

                  <TabsContent value="split" className="mt-3 space-y-3">
                    <div className="rounded-lg border border-white/[0.06] overflow-hidden" style={{ backgroundColor: '#0f0f0f' }}>
                      <div className="h-32 sm:h-40">
                        <WaveformVisualizer
                          audioBuffer={audioBuffer}
                          currentTime={currentTime}
                          isPlaying={isPlaying}
                        />
                      </div>
                    </div>
                    <div className="rounded-lg border border-white/[0.06] overflow-hidden" style={{ backgroundColor: '#0f0f0f' }}>
                      <div className="h-[340px] sm:h-[440px]">
                        <PianoRollVisualizer
                          notes={notes}
                          duration={duration}
                          currentTime={currentTime}
                          isPlaying={isPlaying}
                          bpm={bpm}
                          audioBuffer={audioBuffer}
                        />
                      </div>
                    </div>
                  </TabsContent>
                </Tabs>
              )}

              {/* Audio Player */}
              {audioBuffer && (
                <div className="bg-white/[0.03] rounded-lg border border-white/[0.06] px-4 py-3">
                  <AudioPlayer
                    audioBuffer={audioBuffer}
                    currentTime={currentTime}
                    onTimeUpdate={setCurrentTime}
                    onPlayStateChange={setIsPlaying}
                  />
                </div>
              )}

              {/* Note list (collapsible) */}
              {hasResults && notes.length > 0 && (
                <div className="bg-white/[0.02] rounded-lg border border-white/[0.06] overflow-hidden">
                  <details className="group">
                    <summary className="px-4 py-2.5 cursor-pointer flex items-center justify-between text-xs text-white/40 hover:text-white/60 transition-colors">
                      <span>Detected Notes ({notes.length})</span>
                      <span className="text-[10px] group-open:rotate-180 transition-transform">&#9660;</span>
                    </summary>
                    <div className="max-h-64 overflow-y-auto">
                      <table className="w-full text-xs">
                        <thead className="bg-white/[0.03] sticky top-0">
                          <tr className="text-white/30">
                            <th className="text-left px-4 py-2 font-medium">#</th>
                            <th className="text-left px-4 py-2 font-medium">Note</th>
                            <th className="text-left px-4 py-2 font-medium">Start</th>
                            <th className="text-left px-4 py-2 font-medium">Duration</th>
                            <th className="text-left px-4 py-2 font-medium">Velocity</th>
                          </tr>
                        </thead>
                        <tbody>
                          {notes.map((note, i) => (
                            <tr
                              key={i}
                              className="border-t border-white/[0.03] hover:bg-white/[0.03] transition-colors"
                            >
                              <td className="px-4 py-1.5 text-white/30">{i + 1}</td>
                              <td className="px-4 py-1.5 text-white/70 font-mono">
                                {(() => {
                                  const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
                                  const octave = Math.floor(note.pitchMidi / 12) - 1;
                                  const name = noteNames[note.pitchMidi % 12];
                                  return `${name}${octave}`;
                                })()}
                              </td>
                              <td className="px-4 py-1.5 text-white/50 font-mono">
                                {note.startTimeSeconds.toFixed(2)}s
                              </td>
                              <td className="px-4 py-1.5 text-white/50 font-mono">
                                {(note.durationSeconds * 1000).toFixed(0)}ms
                              </td>
                              <td className="px-4 py-1.5">
                                <div className="flex items-center gap-2">
                                  <div className="flex-1 h-1 bg-white/5 rounded-full max-w-[60px]">
                                    <div
                                      className="h-full bg-green-400/60 rounded-full"
                                      style={{ width: `${note.amplitude * 100}%` }}
                                    />
                                  </div>
                                  <span className="text-white/40 font-mono">
                                    {Math.round(note.amplitude * 127)}
                                  </span>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </details>
                </div>
              )}
            </div>
          )}
        </AnimatePresence>
      </main>

      {/* Footer */}
      <footer className="border-t border-white/[0.06]" style={{ backgroundColor: '#0a0a0a' }}>
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between">
          <p className="text-[11px] text-white/20">
            Built with Next.js + Spotify Basic Pitch + TensorFlow.js
          </p>
          <p className="text-[11px] text-white/20">
            Audio processing runs entirely in your browser
          </p>
        </div>
      </footer>
    </div>
  );
}
