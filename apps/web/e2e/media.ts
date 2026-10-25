// Browser media doubles for the speaking specs, installed with page.addInitScript before the app loads.
import type { Page } from '@playwright/test';

export type MediaStubOptions = {
  /**
   * Browser speech recognition: `false` removes it (the provider/self-rating fallback), a string installs
   * a fake recogniser that "hears" that text shortly after it starts. Default: removed, so tests never
   * depend on Chromium's network recogniser.
   */
  recognition?: false | string;
  /** Make getUserMedia reject with this DOMException name (e.g. NotAllowedError). */
  getUserMediaError?: string;
  /** Answer navigator.permissions.query({ name: 'microphone' }) with this state. */
  micPermission?: 'granted' | 'denied' | 'prompt';
};

/**
 * Counts speechSynthesis.speak calls in `window.__ttsCalls` (texts and langs) and ends each utterance
 * at once, so no test waits on a real voice. Also installs the recognition / getUserMedia doubles.
 */
export async function stubMedia(page: Page, opts: MediaStubOptions = {}) {
  await page.addInitScript((o: MediaStubOptions) => {
    const w = window as unknown as Record<string, unknown>;
    const calls: Array<{ text: string; lang: string; rate: number }> = [];
    w.__ttsCalls = calls;
    if ('speechSynthesis' in window) {
      const synth = window.speechSynthesis;
      synth.speak = (u: SpeechSynthesisUtterance) => {
        calls.push({ text: u.text, lang: u.lang, rate: u.rate });
        setTimeout(() => u.onend?.(new Event('end') as SpeechSynthesisEvent), 10);
      };
      synth.cancel = () => undefined;
    }

    if (o.recognition === undefined || o.recognition === false) {
      Object.defineProperty(window, 'SpeechRecognition', { value: undefined, configurable: true, writable: true });
      Object.defineProperty(window, 'webkitSpeechRecognition', { value: undefined, configurable: true, writable: true });
    } else {
      const heard = o.recognition;
      const langs: string[] = [];
      w.__recognitionLangs = langs;
      class FakeRecognition {
        lang = '';
        interimResults = false;
        continuous = false;
        maxAlternatives = 1;
        onresult: ((e: unknown) => void) | null = null;
        onerror: ((e: unknown) => void) | null = null;
        onend: (() => void) | null = null;
        start() {
          langs.push(this.lang);
          setTimeout(() => {
            const alt = Object.assign([{ transcript: heard }], { isFinal: true });
            this.onresult?.({ results: [alt] });
          }, 150);
        }
        stop() {
          setTimeout(() => this.onend?.(), 0);
        }
        abort() {
          this.stop();
        }
      }
      Object.defineProperty(window, 'SpeechRecognition', { value: FakeRecognition, configurable: true, writable: true });
      Object.defineProperty(window, 'webkitSpeechRecognition', { value: FakeRecognition, configurable: true, writable: true });
    }

    if (o.getUserMediaError && navigator.mediaDevices) {
      const name = o.getUserMediaError;
      navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('Permission denied', name));
    }
    if (o.micPermission && navigator.permissions) {
      const state = o.micPermission;
      const query = navigator.permissions.query.bind(navigator.permissions);
      navigator.permissions.query = (d: PermissionDescriptor) =>
        d.name === ('microphone' as PermissionName) ? Promise.resolve({ state, onchange: null } as PermissionStatus) : query(d);
    }
  }, opts);
}

export async function ttsCalls(page: Page): Promise<Array<{ text: string; lang: string; rate: number }>> {
  return page.evaluate(() => (window as unknown as { __ttsCalls: Array<{ text: string; lang: string; rate: number }> }).__ttsCalls);
}

/** All attempt rows the app stored in IndexedDB. */
export async function storedAttempts(page: Page): Promise<Array<{ exerciseId: string; unitId: string; skill: string; score: number; variety: string }>> {
  return page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const open = indexedDB.open('doppelpunkt');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const all = open.result.transaction('attempts', 'readonly').objectStore('attempts').getAll();
          all.onsuccess = () => resolve(all.result);
          all.onerror = () => reject(all.error);
        };
      }),
  );
}

/** Chromium's fake microphone (a beep) with the permission already granted. */
export const fakeMic = {
  launchOptions: { args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] },
  permissions: ['microphone'],
};
