'use client';

import React, { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Download, RotateCcw, Music2, Zap, BarChart2, Waves } from 'lucide-react';
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
  type DetectedNote,
  type ProcessingProgress,
} from '@/lib/audio-engine';

export default function Home() {
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [audioBuffer, setAudioBuffer] = useState<AudioBuffer | null>(null);
  const [notes, setNotes] = useState<DetectedNote[]>([]);
  const [duration, setDuration] = useState(0);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState<ProcessingProgress | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [activeTab, setActiveTab] = useState('waveform');
  const [fileName, setFileName] = useState('');

  const handleFileSelected = useCallback(async (file: File) => {
    setAudioFile(file);
    setFileName(file.name);
    setNotes([]);
    setAudioBuffer(null);
    setCurrentTime(0);
    setIsPlaying(false);
    setIsProcessing(true);

    try {
      const result = await processAudioToMidi(file, (p) => {
        setProgress(p);
      });

      setNotes(result.notes);
      setAudioBuffer(result.audioBuffer);
      setDuration(result.duration);
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
  }, []);

  const handleDownload = useCallback(async () => {
    if (notes.length > 0) {
      await downloadMidiFile(notes, fileName || 'output');
    }
  }, [notes, fileName]);

  const handleReset = useCallback(() => {
    setAudioFile(null);
    setAudioBuffer(null);
    setNotes([]);
    setDuration(0);
    setProgress(null);
    setCurrentTime(0);
    setIsPlaying(false);
    setFileName('');
    setIsProcessing(false);
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

              {/* Stats */}
              {hasResults && (
                <NoteStats notes={notes} duration={duration} />
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
