/**
 * Acapella to MIDI - Audio Processing Engine
 * Uses Spotify's Basic Pitch for polyphonic note detection
 * Converts audio files (WAV/MP3) to MIDI with pitch bends
 */

export interface DetectedNote {
  startTimeSeconds: number;
  durationSeconds: number;
  pitchMidi: number;
  amplitude: number;
  pitchBends?: number[];
}

export interface TranscriptionOptions {
  onsetThresh: number;
  frameThresh: number;
  minNoteLen: number;
  energyTolerance: number;
  melodiaTrick: boolean;
  minAmplitude: number;
  minDurationSeconds: number;
}

export interface ModelAnalysis {
  frames: number[][];
  onsets: number[][];
  contours: number[][];
  audioBuffer: AudioBuffer;
  duration: number;
}

export const TRANSCRIPTION_PRESETS: Record<string, TranscriptionOptions> = {
  default: {
    onsetThresh: 0.5,
    frameThresh: 0.3,
    minNoteLen: 11,
    energyTolerance: 2.0,
    melodiaTrick: true,
    minAmplitude: 0.05,
    minDurationSeconds: 0.05,
  },
  acapella: {
    onsetThresh: 0.35,
    frameThresh: 0.25,
    minNoteLen: 6,
    energyTolerance: 1.5,
    melodiaTrick: true,
    minAmplitude: 0.03,
    minDurationSeconds: 0.04,
  },
  strict: {
    onsetThresh: 0.65,
    frameThresh: 0.5,
    minNoteLen: 18,
    energyTolerance: 3.5,
    melodiaTrick: true,
    minAmplitude: 0.10,
    minDurationSeconds: 0.08,
  },
  polyphonic: {
    onsetThresh: 0.45,
    frameThresh: 0.3,
    minNoteLen: 10,
    energyTolerance: 2.0,
    melodiaTrick: false,
    minAmplitude: 0.05,
    minDurationSeconds: 0.05,
  },
};

export interface ProcessingResult {
  notes: DetectedNote[];
  duration: number;
  audioBuffer: AudioBuffer;
  bpm: number;
}

export interface ProcessingProgress {
  stage: 'loading' | 'decoding' | 'analyzing' | 'postprocessing' | 'done';
  percent: number;
  message: string;
}

type ProgressCallback = (progress: ProcessingProgress) => void;

// Cache for dynamically loaded modules
let basicPitchModule: typeof import('@spotify/basic-pitch') | null = null;

async function loadBasicPitch() {
  if (basicPitchModule) return basicPitchModule;

  // Dynamically import to ensure TF.js is loaded in browser context
  basicPitchModule = await import('@spotify/basic-pitch');
  try {
    const tf = await import('@tensorflow/tfjs');
    console.log('[audio-engine] TensorFlow.js loaded. Current backend:', tf.getBackend());
  } catch (err) {
    console.warn('[audio-engine] Could not import tfjs to check backend:', err);
  }
  return basicPitchModule;
}

/**
 * Convert an audio File to AudioBuffer using Web Audio API
 * Decodes at the file's native sample rate for maximum quality,
 * then resampleToMono22050() handles conversion to 22050Hz mono.
 */
async function decodeAudioFile(file: File): Promise<AudioBuffer> {
  const arrayBuffer = await file.arrayBuffer();
  // Use default sample rate (usually 44100 or 48000) for best decode quality
  // We resample to 22050Hz mono separately afterward
  const audioContext = new AudioContext();
  try {
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
    return audioBuffer;
  } finally {
    await audioContext.close();
  }
}

/**
 * Resample AudioBuffer to mono 22050Hz (required by Basic Pitch)
 */
function resampleToMono22050(audioBuffer: AudioBuffer): Float32Array {
  const targetSampleRate = 22050;
  const duration = audioBuffer.duration;
  const targetLength = Math.ceil(duration * targetSampleRate);

  // Mix down to mono
  if (audioBuffer.numberOfChannels > 1) {
    const mixed = new Float32Array(audioBuffer.length);
    for (let ch = 0; ch < audioBuffer.numberOfChannels; ch++) {
      const data = audioBuffer.getChannelData(ch);
      for (let i = 0; i < audioBuffer.length; i++) {
        mixed[i] += data[i] / audioBuffer.numberOfChannels;
      }
    }
    if (audioBuffer.sampleRate === targetSampleRate) {
      return mixed;
    }
    return resampleFloat32Array(mixed, audioBuffer.sampleRate, targetSampleRate, targetLength);
  }

  const channelData = audioBuffer.getChannelData(0);
  if (audioBuffer.sampleRate === targetSampleRate) {
    return channelData;
  }

  return resampleFloat32Array(channelData, audioBuffer.sampleRate, targetSampleRate, targetLength);
}

/**
 * Simple linear interpolation resampler
 */
function resampleFloat32Array(
  data: Float32Array,
  fromRate: number,
  toRate: number,
  targetLength: number
): Float32Array {
  const result = new Float32Array(targetLength);
  const ratio = fromRate / toRate;

  for (let i = 0; i < targetLength; i++) {
    const srcIndex = i * ratio;
    const srcIndexFloor = Math.floor(srcIndex);
    const srcIndexCeil = Math.min(srcIndexFloor + 1, data.length - 1);
    const fraction = srcIndex - srcIndexFloor;

    result[i] = data[srcIndexFloor] * (1 - fraction) + data[srcIndexCeil] * fraction;
  }

  return result;
}

/**
 * Main processing pipeline: Audio File -> Detected Notes
 */
export async function runModelAnalysis(
  file: File,
  onProgress: ProgressCallback
): Promise<ModelAnalysis> {
  // Stage 0: Load model
  onProgress({
    stage: 'loading',
    percent: 2,
    message: 'Loading Basic Pitch AI model...',
  });

  const bp = await loadBasicPitch();
  console.log('[audio-engine] Basic Pitch module loaded');

  // Stage 1: Decode audio
  onProgress({
    stage: 'decoding',
    percent: 5,
    message: 'Decoding audio file...',
  });

  const audioBuffer = await decodeAudioFile(file);
  const duration = audioBuffer.duration;

  console.log(`[audio-engine] Audio decoded: ${duration.toFixed(1)}s, ${audioBuffer.numberOfChannels}ch @ ${audioBuffer.sampleRate}Hz`);

  onProgress({
    stage: 'decoding',
    percent: 20,
    message: `Audio decoded: ${duration.toFixed(1)}s, ${audioBuffer.numberOfChannels}ch @ ${audioBuffer.sampleRate}Hz`,
  });

  // Stage 2: Resample to mono 22050Hz
  onProgress({
    stage: 'analyzing',
    percent: 25,
    message: 'Resampling audio for analysis...',
  });

  const monoData = resampleToMono22050(audioBuffer);
  console.log(`[audio-engine] Resampled to mono 22050Hz: ${monoData.length} samples`);

  // Stage 3: Run Basic Pitch model
  onProgress({
    stage: 'analyzing',
    percent: 30,
    message: 'Running Basic Pitch neural network...',
  });

  const modelPath = '/basic-pitch-model/model.json';
  const basicPitch = new bp.BasicPitch(modelPath);

  // IMPORTANT: evaluateModel calls the onComplete callback once per audio chunk (~2s each).
  // We must ACCUMULATE (concatenate) the results, not replace them.
  let frames: number[][] = [];
  let onsets: number[][] = [];
  let contours: number[][] = [];
  let chunkCount = 0;

  await basicPitch.evaluateModel(
    monoData,
    (f, o, c) => {
      chunkCount++;
      // Concatenate each chunk's results to build the full output
      frames = frames.concat(f);
      onsets = onsets.concat(o);
      contours = contours.concat(c);
    },
    (percent: number) => {
      const mappedPercent = 30 + percent * 0.5;
      onProgress({
        stage: 'analyzing',
        percent: Math.round(mappedPercent),
        message: `Analyzing pitch... ${Math.round(percent)}%`,
      });
    }
  );

  console.log(`[audio-engine] Model evaluation complete: ${chunkCount} chunks, ${frames.length} frames, ${onsets.length} onsets, ${contours.length} contours`);

  return {
    frames,
    onsets,
    contours,
    audioBuffer,
    duration,
  };
}

export async function extractNotesFromAnalysis(
  analysis: ModelAnalysis,
  options: TranscriptionOptions
): Promise<DetectedNote[]> {
  const bp = await loadBasicPitch();

  const noteEvents = bp.outputToNotesPoly(
    analysis.frames,
    analysis.onsets,
    options.onsetThresh,
    options.frameThresh,
    options.minNoteLen,
    true,     // inferOnsets - helps catch glissando
    undefined, // maxFreq
    undefined, // minFreq
    options.melodiaTrick,
    options.energyTolerance
  );

  console.log(`[audio-engine] Note events extracted: ${noteEvents.length} raw notes`);

  const noteEventsWithBends = bp.addPitchBendsToNoteEvents(analysis.contours, noteEvents, 1);
  const notesTime = bp.noteFramesToTime(noteEventsWithBends);

  const detectedNotes: DetectedNote[] = notesTime.map((note) => ({
    startTimeSeconds: note.startTimeSeconds,
    durationSeconds: note.durationSeconds,
    pitchMidi: note.pitchMidi,
    amplitude: note.amplitude,
    pitchBends: note.pitchBends,
  }));

  console.log(`[audio-engine] Raw notes: ${detectedNotes.length}`);

  const cleanedNotes = postProcessNotes(detectedNotes, options);
  return cleanedNotes;
}

/**
 * Main processing pipeline: Audio File -> Detected Notes
 */
export async function processAudioToMidi(
  file: File,
  onProgress: ProgressCallback,
  options: TranscriptionOptions = TRANSCRIPTION_PRESETS.default
): Promise<ProcessingResult> {
  const analysis = await runModelAnalysis(file, onProgress);

  // Stage 4: Convert model output to notes
  onProgress({
    stage: 'postprocessing',
    percent: 85,
    message: 'Extracting note events...',
  });

  const cleanedNotes = await extractNotesFromAnalysis(analysis, options);
  console.log(`[audio-engine] After post-processing: ${cleanedNotes.length} notes`);

  // Stage 6: Detect BPM from note onsets
  onProgress({
    stage: 'postprocessing',
    percent: 95,
    message: 'Detecting tempo...',
  });

  const bpm = detectBPM(cleanedNotes);
  console.log(`[audio-engine] Detected BPM: ${bpm}`);

  onProgress({
    stage: 'done',
    percent: 100,
    message: `Done! Detected ${cleanedNotes.length} notes at ${bpm} BPM`,
  });

  return {
    notes: cleanedNotes,
    duration: analysis.duration,
    audioBuffer: analysis.audioBuffer,
    bpm,
  };
}

/**
 * Post-process detected notes to produce cleaner, more musical results:
 * 1. Filter out short noise notes (<60ms) and quiet notes (amplitude < 0.08)
 * 2. Merge adjacent notes on the same pitch (gap < 150ms)
 * 3. Merge notes within ±1 semitone (vocal wobble) if gap < 50ms
 * 4. Remove outlier notes far from neighbors
 * 5. Second-pass cleanup of remaining short fragments
 */
function postProcessNotes(notes: DetectedNote[], options: TranscriptionOptions): DetectedNote[] {
  if (notes.length === 0) return notes;

  // Step 1: Filter noise — remove short and quiet notes
  let filtered = notes.filter(n => 
    n.durationSeconds >= options.minDurationSeconds &&
    n.amplitude >= options.minAmplitude
  );

  if (filtered.length === 0) return filtered;

  // Step 2: Sort by pitch then start time for same-pitch merging
  filtered.sort((a, b) => {
    if (a.pitchMidi !== b.pitchMidi) return a.pitchMidi - b.pitchMidi;
    return a.startTimeSeconds - b.startTimeSeconds;
  });

  // Step 3: Merge adjacent notes on the SAME pitch (gap < 150ms)
  let merged: DetectedNote[] = [];
  let current: DetectedNote | null = null;

  for (const note of filtered) {
    if (!current) {
      current = { ...note, pitchBends: note.pitchBends ? [...note.pitchBends] : undefined };
      continue;
    }

    const currentEnd = current.startTimeSeconds + current.durationSeconds;
    const gap = note.startTimeSeconds - currentEnd;

    // Same pitch and gap < 150ms → merge
    if (note.pitchMidi === current.pitchMidi && gap < 0.15 && gap > -0.02) {
      const newEnd = note.startTimeSeconds + note.durationSeconds;
      current.durationSeconds = newEnd - current.startTimeSeconds;
      current.amplitude = Math.max(current.amplitude, note.amplitude); // keep strongest
      if (current.pitchBends && note.pitchBends) {
        current.pitchBends = [...current.pitchBends, ...note.pitchBends];
      } else if (note.pitchBends) {
        current.pitchBends = [...note.pitchBends];
      }
    } else {
      merged.push(current);
      current = { ...note, pitchBends: note.pitchBends ? [...note.pitchBends] : undefined };
    }
  }
  if (current) merged.push(current);

  // Step 4: Sort by time, then merge notes within ±1 semitone (vocal wobble)
  merged.sort((a, b) => a.startTimeSeconds - b.startTimeSeconds);
  const wobbleMerged: DetectedNote[] = [];
  current = null;

  for (const note of merged) {
    if (!current) {
      current = { ...note };
      continue;
    }

    const currentEnd = current.startTimeSeconds + current.durationSeconds;
    const gap = note.startTimeSeconds - currentEnd;
    const pitchDiff = Math.abs(note.pitchMidi - current.pitchMidi);

    // Adjacent in time (< 50ms gap) and within ±1 semitone → merge, keep stronger pitch
    if (pitchDiff <= 1 && gap < 0.05 && gap > -0.02) {
      const newEnd = note.startTimeSeconds + note.durationSeconds;
      current.durationSeconds = newEnd - current.startTimeSeconds;
      // Keep the pitch of the note with higher amplitude
      if (note.amplitude > current.amplitude) {
        current.pitchMidi = note.pitchMidi;
      }
      current.amplitude = Math.max(current.amplitude, note.amplitude);
      if (current.pitchBends && note.pitchBends) {
        current.pitchBends = [...current.pitchBends, ...note.pitchBends];
      } else if (note.pitchBends) {
        current.pitchBends = [...note.pitchBends];
      }
    } else {
      wobbleMerged.push(current);
      current = { ...note };
    }
  }
  if (current) wobbleMerged.push(current);

  // Step 5: Remove outlier notes (>12 semitones away from any neighbor within 1s)
  const cleaned = wobbleMerged.filter((note, i) => {
    // Check neighbors within 1 second
    let hasNearby = false;
    for (let j = Math.max(0, i - 5); j < Math.min(wobbleMerged.length, i + 6); j++) {
      if (j === i) continue;
      const other = wobbleMerged[j];
      const timeDiff = Math.abs(note.startTimeSeconds - other.startTimeSeconds);
      if (timeDiff < 1.0 && Math.abs(note.pitchMidi - other.pitchMidi) <= 12) {
        hasNearby = true;
        break;
      }
    }
    return hasNearby;
  });

  // Step 6: Final cleanup — remove any remaining very short notes after merging
  const final = cleaned.filter(n => n.durationSeconds >= options.minDurationSeconds);

  // Sort by start time
  final.sort((a, b) => a.startTimeSeconds - b.startTimeSeconds);

  return final;
}

/**
 * Convert MIDI pitch number to note name (e.g., 60 -> "C4")
 */
export function midiPitchToName(midi: number): string {
  const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const octave = Math.floor(midi / 12) - 1;
  const note = noteNames[midi % 12];
  return `${note}${octave}`;
}

/**
 * Detect BPM from detected note onsets using inter-onset interval analysis.
 * Clusters IOIs and finds the most common tempo.
 */
export function detectBPM(notes: DetectedNote[]): number {
  if (notes.length < 4) return 120; // fallback

  // Sort by start time
  const sorted = [...notes].sort((a, b) => a.startTimeSeconds - b.startTimeSeconds);

  // Compute inter-onset intervals
  const iois: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const ioi = sorted[i].startTimeSeconds - sorted[i - 1].startTimeSeconds;
    if (ioi > 0.05 && ioi < 2.0) { // filter out very small or very large gaps
      iois.push(ioi);
    }
  }

  if (iois.length < 3) return 120;

  // Create a histogram of IOIs with 10ms bins
  const binSize = 0.01;
  const bins = new Map<number, number>();
  for (const ioi of iois) {
    const bin = Math.round(ioi / binSize) * binSize;
    bins.set(bin, (bins.get(bin) || 0) + 1);
  }

  // Find peaks in the histogram using a smoothed approach
  // Convert IOIs to BPM candidates and cluster them
  const bpmCandidates: number[] = iois.map(ioi => 60 / ioi);
  
  // Cluster BPM candidates (within ±5 BPM)
  const clusters: { bpm: number; count: number; sum: number }[] = [];
  for (const bpm of bpmCandidates) {
    if (bpm < 40 || bpm > 240) continue; // reasonable range
    
    let found = false;
    for (const cluster of clusters) {
      if (Math.abs(cluster.bpm - bpm) < 5) {
        cluster.count++;
        cluster.sum += bpm;
        cluster.bpm = cluster.sum / cluster.count; // running average
        found = true;
        break;
      }
    }
    if (!found) {
      clusters.push({ bpm, count: 1, sum: bpm });
    }
  }

  // Also check for half/double time
  for (const bpm of bpmCandidates) {
    const halfBpm = bpm / 2;
    const dblBpm = bpm * 2;
    
    for (const cluster of clusters) {
      if (halfBpm >= 40 && halfBpm <= 240 && Math.abs(cluster.bpm - halfBpm) < 5) {
        cluster.count += 0.5; // partial weight for harmonics
      }
      if (dblBpm >= 40 && dblBpm <= 240 && Math.abs(cluster.bpm - dblBpm) < 5) {
        cluster.count += 0.5;
      }
    }
  }

  if (clusters.length === 0) return 120;

  // Sort by count, pick the best
  clusters.sort((a, b) => b.count - a.count);
  
  // Round to nearest integer
  return Math.round(clusters[0].bpm);
}

/**
 * Generate MIDI file bytes from detected notes using midi-writer-js
 */
export async function generateMidiFileBytes(notes: DetectedNote[]): Promise<Uint8Array> {
  // Use midi-writer-js for reliable browser MIDI generation
  const MidiWriterModule = await import('midi-writer-js');
  const MidiWriter = MidiWriterModule.default || MidiWriterModule;

  const track = new MidiWriter.Track();

  // Set tempo (120 BPM default, will be adjusted based on actual tempo)
  track.setTempo(120);

  // Sort notes by start time
  const sortedNotes = [...notes].sort((a, b) => a.startTimeSeconds - b.startTimeSeconds);

  // Convert to MIDI writer note events
  let prevEndTick = 0;
  for (const note of sortedNotes) {
    const startTick = Math.round(note.startTimeSeconds * 480 * 2); // 480 ticks per beat, 120 BPM
    const durationTicks = Math.max(1, Math.round(note.durationSeconds * 480 * 2));
    const wait = Math.max(0, startTick - prevEndTick);

    track.addEvent(
      new MidiWriter.NoteEvent({
        pitch: note.pitchMidi,
        duration: `T${durationTicks}`,
        velocity: Math.round(note.amplitude * 100) + 20,
        wait: wait > 0 ? `T${wait}` : '0',
      })
    );

    prevEndTick = startTick + durationTicks;
  }

  const writer = new MidiWriter.Writer([track]);
  return writer.buildFile();
}

/**
 * Generate and download MIDI file
 */
export async function downloadMidiFile(notes: DetectedNote[], filename: string): Promise<void> {
  try {
    const midiBytes = await generateMidiFileBytes(notes);
    const blob = new Blob([midiBytes as any], { type: 'audio/midi' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename.replace(/\.[^.]+$/, '.mid');
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch (error) {
    console.error('Error generating MIDI file:', error);
    throw error;
  }
}
