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
  if (opts.url && (await playUrl(opts.url, opts.rate))) return;
  await speak(opts.text, opts.variety, opts.rate);
}

/** Plays an audio file at a playback rate. Resolves true when it played to the end, false when it failed. */
export async function playUrl(url: string, rate = 1): Promise<boolean> {
  try {
    const audio = new Audio(url);
    audio.playbackRate = rate;
    // Keep the pitch natural when slowed down (default in most browsers, explicit for Safari).
    (audio as HTMLAudioElement & { preservesPitch?: boolean }).preservesPitch = true;
    const ended = new Promise<boolean>((resolve) => {
      audio.onended = () => resolve(true);
      audio.onerror = () => resolve(false);
    });
    await audio.play();
    return await ended;
  } catch {
    return false;
  }
}

const isGswVariety = (v: Variety) => v === 'gsw-zh' || v === 'gsw-be';

/**
 * Where the "native" model comes from: a recording, a TTS voice, or nothing. TTS voices only speak
 * Standard German, so Swiss German without a recording has no native model ("No recording yet").
 */
export function nativeSource(variety: Variety, url?: string): 'audio' | 'tts' | 'none' {
  if (url) return 'audio';
  if (isGswVariety(variety) || !canSpeak()) return 'none';
  return 'tts';
}

/**
 * Plays the native model at `rate` (0.75–1.25). Uses the recording when there is one; falls back to
 * TTS only for Standard German. Resolves false when nothing could be played.
 */
export async function playNative(opts: { url?: string; text: string; variety: Variety; rate?: number }): Promise<boolean> {
  const rate = opts.rate ?? 1;
  if (opts.url && (await playUrl(opts.url, rate))) return true;
  if (isGswVariety(opts.variety) || !canSpeak()) return false;
  await speak(opts.text, opts.variety, rate);
  return true;
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

/** Browser recognition language: de-DE for Standard German, de-CH for Swiss varieties (closest available). */
export function recognitionLang(v: Variety): string {
  return ttsLang(v);
}

export type Recording = {
  /** The microphone stream (for a level meter); undefined when only recognition runs. */
  stream?: MediaStream;
  /** true when browser speech recognition is listening alongside the recorder. */
  recognizing: boolean;
  /** Stops recording; resolves with the audio and the recognised text (empty if unsupported). */
  stop: () => Promise<{ audio?: Blob; transcript: string }>;
  cancel: () => void;
};

export type RecordingOptions = {
  onInterim?: (text: string) => void;
  /** Run browser speech recognition too (default: when available). */
  recognize?: boolean;
};

/** A MIME type this browser's MediaRecorder supports (Safari records audio/mp4, Chrome audio/webm). */
function recorderMime(): string | undefined {
  if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') return undefined;
  return ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'].find((t) => MediaRecorder.isTypeSupported(t));
}

/** Starts the microphone recorder and (when available) speech recognition at the same time. */
export async function startRecording(variety: Variety, opts: RecordingOptions | ((text: string) => void) = {}): Promise<Recording> {
  const { onInterim, recognize = true } = typeof opts === 'function' ? { onInterim: opts } : opts;
  let recorder: MediaRecorder | undefined;
  let stream: MediaStream | undefined;
  const chunks: Blob[] = [];
  if (canRecord()) {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    const mimeType = recorderMime();
    recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
    recorder.ondataavailable = (e) => {
      if (e.data.size) chunks.push(e.data);
    };
    recorder.start();
  }

  let transcript = '';
  let recognition: Recognition | undefined;
  let recognitionDone: Promise<void> = Promise.resolve();
  const Ctor = recognize ? recognitionCtor() : undefined;
  if (Ctor) {
    recognition = new Ctor();
    recognition.lang = recognitionLang(variety);
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
  if (!recorder && !recognition) throw new MicError('unsupported', 'Recording is not supported in this browser.');

  const release = () => stream?.getTracks().forEach((t) => t.stop());

  return {
    stream,
    recognizing: !!recognition,
    stop: async () => {
      const audioDone = new Promise<Blob | undefined>((resolve) => {
        if (!recorder || recorder.state === 'inactive') return resolve(undefined);
        recorder.onstop = () => resolve(chunks.length ? new Blob(chunks, { type: recorder?.mimeType || 'audio/webm' }) : undefined);
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

// ---------------------------------------------------------------------------------------------
// Microphone permission

export type MicState = 'unknown' | 'prompt' | 'granted' | 'denied' | 'unsupported';
export type MicErrorKind = 'denied' | 'no-device' | 'busy' | 'insecure' | 'unsupported' | 'other';

export class MicError extends Error {
  constructor(
    readonly kind: MicErrorKind,
    message: string,
  ) {
    super(message);
    this.name = 'MicError';
  }
}

/** Maps a getUserMedia / recorder error to a kind the UI can explain. */
export function micErrorKind(e: unknown): MicErrorKind {
  if (e instanceof MicError) return e.kind;
  const name = (e as { name?: string } | undefined)?.name ?? '';
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError' || name === 'SecurityError') {
    return typeof window !== 'undefined' && window.isSecureContext === false ? 'insecure' : 'denied';
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError' || name === 'OverconstrainedError') return 'no-device';
  if (name === 'NotReadableError' || name === 'TrackStartError' || name === 'AbortError') return 'busy';
  if (name === 'NotSupportedError' || name === 'TypeError') return 'unsupported';
  return 'other';
}

/** Current microphone permission, where the Permissions API knows it (Safari < 16 does not). */
export async function micPermission(): Promise<MicState> {
  if (!canRecord() && !canRecognize()) return 'unsupported';
  try {
    const status = await navigator.permissions?.query({ name: 'microphone' as PermissionName });
    if (!status) return 'unknown';
    return status.state === 'granted' ? 'granted' : status.state === 'denied' ? 'denied' : 'prompt';
  } catch {
    return 'unknown';
  }
}

export type Platform = 'ios' | 'android' | 'mac-safari' | 'firefox' | 'desktop';

export function detectPlatform(ua = typeof navigator === 'undefined' ? '' : navigator.userAgent): Platform {
  if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && typeof navigator !== 'undefined' && navigator.maxTouchPoints > 1)) return 'ios';
  if (/Android/.test(ua)) return 'android';
  if (/Firefox\//.test(ua)) return 'firefox';
  if (/Macintosh/.test(ua) && /Safari\//.test(ua) && !/Chrome|Chromium|Edg\//.test(ua)) return 'mac-safari';
  return 'desktop';
}

/** How to turn the microphone back on after "Block", per platform. */
export function micFixSteps(platform: Platform = detectPlatform()): string[] {
  switch (platform) {
    case 'ios':
      return [
        'Open the Settings app → Safari → Microphone and choose "Ask" or "Allow".',
        'Or, in Safari, tap "aA" in the address bar → Website Settings → Microphone → Allow.',
        'Installed on the Home Screen? Settings → Doppelpunkt (or Safari) → Microphone.',
        'Then reload this page.',
      ];
    case 'android':
      return [
        'Tap the icon left of the address bar → Permissions → Microphone → Allow.',
        'If Chrome itself has no microphone access: Android Settings → Apps → Chrome → Permissions → Microphone.',
        'Then reload this page.',
      ];
    case 'mac-safari':
      return ['Safari → Settings for This Website… → Microphone → Allow.', 'Check System Settings → Privacy & Security → Microphone too.', 'Then reload this page.'];
    case 'firefox':
      return ['Click the microphone icon in the address bar and remove the block.', 'Then reload this page and choose "Allow".'];
    default:
      return [
        'Click the lock or settings icon left of the address bar → Microphone → Allow.',
        'Check your system\'s privacy settings allow the browser to use the microphone.',
        'Then reload this page.',
      ];
  }
}

// ---------------------------------------------------------------------------------------------
// Recording length (for the transcription cost meter)

// Recordings know how long they are; the recorder notes it here so the cost meter needn't decode audio.
const audioSeconds = new WeakMap<Blob, number>();

export function noteAudioSeconds(audio: Blob, seconds: number): void {
  if (Number.isFinite(seconds) && seconds > 0) audioSeconds.set(audio, seconds);
}

/**
 * Length of a recording in seconds: what the recorder noted, otherwise an estimate from the file
 * size at ~48 kbit/s (Opus/AAC speech; a low bitrate estimates long, so the meter errs on the high side).
 */
export function audioSecondsOf(audio: Blob): { seconds: number; estimated: boolean } {
  const noted = audioSeconds.get(audio);
  if (noted !== undefined) return { seconds: noted, estimated: false };
  return { seconds: Math.max(1, audio.size / 6000), estimated: true };
}
