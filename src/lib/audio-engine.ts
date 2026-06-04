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

export interface ProcessingResult {
  notes: DetectedNote[];
  duration: number;
  audioBuffer: AudioBuffer;
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
export async function processAudioToMidi(
  file: File,
  onProgress: ProgressCallback
): Promise<ProcessingResult> {
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

  // Stage 4: Convert model output to notes
  onProgress({
    stage: 'postprocessing',
    percent: 85,
    message: 'Extracting note events...',
  });

  const noteEvents = bp.outputToNotesPoly(
    frames,
    onsets,
    0.5,      // onsetThresh - slightly lower for soft vocal onsets
    0.3,      // frameThresh - lower threshold for sustained notes
    11,       // minNoteLen - minimum note length in frames
    true,     // inferOnsets - helps catch glissando
    undefined, // maxFreq
    undefined, // minFreq
    true,     // melodiaTrick - better for monophonic voice
    2         // energyTolerance
  );

  console.log(`[audio-engine] Note events extracted: ${noteEvents.length} raw notes`);

  const noteEventsWithBends = bp.addPitchBendsToNoteEvents(contours, noteEvents, 1);
  const notesTime = bp.noteFramesToTime(noteEventsWithBends);

  const detectedNotes: DetectedNote[] = notesTime.map((note) => ({
    startTimeSeconds: note.startTimeSeconds,
    durationSeconds: note.durationSeconds,
    pitchMidi: note.pitchMidi,
    amplitude: note.amplitude,
    pitchBends: note.pitchBends,
  }));

  console.log(`[audio-engine] Final: ${detectedNotes.length} notes detected`);

  onProgress({
    stage: 'done',
    percent: 100,
    message: `Done! Detected ${detectedNotes.length} notes`,
  });

  return {
    notes: detectedNotes,
    duration,
    audioBuffer,
  };
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
    const blob = new Blob([midiBytes.buffer], { type: 'audio/midi' });
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
