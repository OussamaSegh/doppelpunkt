// Browser speech helpers: audio playback with a speechSynthesis fallback, recording and recognition.
import type { Variety } from '@doppelpunkt/content-schema';
import { ttsLang } from './varieties';

export function canSpeak(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined';
}

/** Speaks text with a German voice. Resolves when finished (or immediately if TTS is unavailable). */
export function speak(text: string, variety: Variety = 'de', rate = 1): Promise<void> {
  if (!canSpeak()) return Promise.resolve();
  return new Promise((resolve) => {
    const synth = window.speechSynthesis;
    synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    const lang = ttsLang(variety);
    u.lang = lang;
    u.rate = rate;
    const voices = synth.getVoices();
    const voice = voices.find((v) => v.lang === lang) ?? voices.find((v) => v.lang.startsWith('de'));
    if (voice) u.voice = voice;
    u.onend = () => resolve();
    u.onerror = () => resolve();
    synth.speak(u);
  });
}

/** Plays a recorded file; falls back to TTS of `text` when the file is missing or fails. */
export async function playOrSpeak(opts: { url?: string; text: string; variety?: Variety; rate?: number }): Promise<void> {
  if (opts.url) {
    try {
      const audio = new Audio(opts.url);
      audio.playbackRate = opts.rate ?? 1;
      await audio.play();
      await new Promise<void>((resolve) => {
        audio.onended = () => resolve();
        audio.onerror = () => resolve();
      });
      return;
    } catch {
      /* fall through to TTS */
    }
  }
  await speak(opts.text, opts.variety, opts.rate);
}

// Minimal typings for the Web Speech recognition API (not in lib.dom).
type RecognitionResultEvent = { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> };
type Recognition = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  onresult: ((e: RecognitionResultEvent) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};
type RecognitionCtor = new () => Recognition;

function recognitionCtor(): RecognitionCtor | undefined {
  if (typeof window === 'undefined') return undefined;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
}

export function canRecognize(): boolean {
  return recognitionCtor() !== undefined;
}

export function canRecord(): boolean {
  return typeof window !== 'undefined' && typeof MediaRecorder !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;
}

export type Recording = {
  /** Stops recording; resolves with the audio and the recognised text (empty if unsupported). */
  stop: () => Promise<{ audio?: Blob; transcript: string }>;
  cancel: () => void;
};

/** Starts the microphone recorder and (when available) speech recognition at the same time. */
export async function startRecording(variety: Variety, onInterim?: (text: string) => void): Promise<Recording> {
  let recorder: MediaRecorder | undefined;
  let stream: MediaStream | undefined;
  const chunks: Blob[] = [];
  if (canRecord()) {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    recorder = new MediaRecorder(stream);
    recorder.ondataavailable = (e) => {
      if (e.data.size) chunks.push(e.data);
    };
    recorder.start();
  }

  let transcript = '';
  let recognition: Recognition | undefined;
  let recognitionDone: Promise<void> = Promise.resolve();
  const Ctor = recognitionCtor();
  if (Ctor) {
    recognition = new Ctor();
    recognition.lang = ttsLang(variety);
    recognition.interimResults = true;
    recognition.continuous = true;
    recognition.maxAlternatives = 1;
    const rec = recognition;
    recognitionDone = new Promise<void>((resolve) => {
      rec.onresult = (e) => {
        transcript = Array.from(e.results)
          .map((r) => r[0]?.transcript ?? '')
          .join(' ')
          .trim();
        onInterim?.(transcript);
      };
      rec.onerror = () => resolve();
      rec.onend = () => resolve();
    });
    try {
      recognition.start();
    } catch {
      recognition = undefined;
    }
  }

  const release = () => stream?.getTracks().forEach((t) => t.stop());

  return {
    stop: async () => {
      const audioDone = new Promise<Blob | undefined>((resolve) => {
        if (!recorder || recorder.state === 'inactive') return resolve(undefined);
        recorder.onstop = () => resolve(new Blob(chunks, { type: recorder?.mimeType || 'audio/webm' }));
        recorder.stop();
      });
      recognition?.stop();
      const [audio] = await Promise.all([audioDone, Promise.race([recognitionDone, wait(1500)])]);
      release();
      return { audio, transcript };
    },
    cancel: () => {
      recognition?.abort();
      if (recorder && recorder.state !== 'inactive') recorder.stop();
      release();
    },
  };
}

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
