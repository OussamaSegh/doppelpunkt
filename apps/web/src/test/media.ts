// Test doubles for the browser media APIs jsdom lacks: MediaRecorder, getUserMedia,
// SpeechRecognition, speechSynthesis, Audio and object URLs. install() returns handles to drive them.
import { vi } from 'vitest';

export class FakeRecorder {
  static instances: FakeRecorder[] = [];
  static isTypeSupported = (t: string) => t.startsWith('audio/webm');
  state: 'inactive' | 'recording' = 'inactive';
  mimeType: string;
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  constructor(
    readonly stream: MediaStream,
    opts?: { mimeType?: string },
  ) {
    this.mimeType = opts?.mimeType ?? 'audio/webm';
    FakeRecorder.instances.push(this);
  }
  start() {
    this.state = 'recording';
  }
  stop() {
    if (this.state === 'inactive') return;
    this.state = 'inactive';
    this.ondataavailable?.({ data: new Blob(['take'], { type: this.mimeType }) });
    queueMicrotask(() => this.onstop?.());
  }
}

type ResultList = ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>;

export class FakeRecognition {
  static instances: FakeRecognition[] = [];
  lang = '';
  interimResults = false;
  continuous = false;
  maxAlternatives = 1;
  onresult: ((e: { results: ResultList }) => void) | null = null;
  onerror: ((e: { error: string }) => void) | null = null;
  onend: (() => void) | null = null;
  running = false;
  constructor() {
    FakeRecognition.instances.push(this);
  }
  start() {
    this.running = true;
  }
  stop() {
    this.running = false;
    queueMicrotask(() => this.onend?.());
  }
  abort() {
    this.running = false;
  }
  /** Simulates the recogniser hearing `text`. */
  hear(text: string) {
    const alt = Object.assign([{ transcript: text }], { isFinal: true });
    this.onresult?.({ results: [alt] });
  }
}

export class FakeAudio {
  static instances: FakeAudio[] = [];
  playbackRate = 1;
  preservesPitch = true;
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(readonly src: string) {
    FakeAudio.instances.push(this);
  }
  play() {
    queueMicrotask(() => this.onended?.());
    return Promise.resolve();
  }
}

type Options = { recorder?: boolean; recognition?: boolean; tts?: boolean; getUserMedia?: () => Promise<MediaStream> };

const track = () => ({ stop: vi.fn(), kind: 'audio' });
export const fakeStream = () => ({ getTracks: () => [track()], getAudioTracks: () => [track()] }) as unknown as MediaStream;

/** Installs the fakes on window/navigator; call the returned function (or restore()) in afterEach. */
export function installMedia(opts: Options = {}) {
  const { recorder = true, recognition = false, tts = true } = opts;
  FakeRecorder.instances = [];
  FakeRecognition.instances = [];
  FakeAudio.instances = [];
  const w = window as unknown as Record<string, unknown>;
  const getUserMedia = vi.fn(opts.getUserMedia ?? (() => Promise.resolve(fakeStream())));
  const spoken: Array<{ text: string; rate: number; lang: string }> = [];

  vi.stubGlobal('MediaRecorder', recorder ? FakeRecorder : undefined);
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: recorder ? { getUserMedia } : undefined });
  w.SpeechRecognition = recognition ? FakeRecognition : undefined;
  w.webkitSpeechRecognition = undefined;
  vi.stubGlobal('Audio', FakeAudio);
  if (tts) {
    vi.stubGlobal(
      'SpeechSynthesisUtterance',
      class {
        lang = '';
        rate = 1;
        voice: unknown;
        onend: (() => void) | null = null;
        onerror: (() => void) | null = null;
        constructor(readonly text: string) {}
      },
    );
    w.speechSynthesis = {
      cancel: vi.fn(),
      getVoices: () => [],
      speak: (u: { text: string; rate: number; lang: string; onend?: () => void }) => {
        spoken.push({ text: u.text, rate: u.rate, lang: u.lang });
        queueMicrotask(() => u.onend?.());
      },
    };
  } else {
    delete w.speechSynthesis;
    vi.stubGlobal('SpeechSynthesisUtterance', undefined);
  }
  URL.createObjectURL = vi.fn(() => 'blob:take');
  URL.revokeObjectURL = vi.fn();

  return {
    getUserMedia,
    spoken,
    recognition: () => FakeRecognition.instances[FakeRecognition.instances.length - 1],
    restore: () => {
      vi.unstubAllGlobals();
      delete w.SpeechRecognition;
      delete w.speechSynthesis;
      Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: undefined });
    },
  };
}

export const domError = (name: string) => Object.assign(new Error(name), { name });
