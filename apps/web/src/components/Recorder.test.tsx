import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { detectPlatform, micErrorKind, micFixSteps, nativeSource } from '../lib/speech';
import { domError, FakeAudio, FakeRecorder, installMedia } from '../test/media';
import { defaultMaxSeconds, Recorder } from './Recorder';

let media: ReturnType<typeof installMedia>;
afterEach(() => media?.restore());

describe('Recorder', () => {
  it('records, shows the timer and level, then plays "you" next to "native"', async () => {
    media = installMedia();
    const onRecorded = vi.fn();
    render(<Recorder text="Hallo, ich bin Anna." variety="de" onRecorded={onRecorded} />);
    expect(screen.getByText('Not recorded yet.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Play native (synthetic voice)' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Record' }));
    const stop = await screen.findByRole('button', { name: 'Stop recording' });
    expect(media.getUserMedia).toHaveBeenCalledWith({ audio: expect.objectContaining({ echoCancellation: true }) });
    expect(FakeRecorder.instances[0]?.mimeType).toBe('audio/webm;codecs=opus');
    expect(screen.getByRole('timer')).toHaveTextContent(/Recording 0:00 \/ 0:0\d/);

    fireEvent.click(stop);
    expect(await screen.findByLabelText('Your recording')).toHaveAttribute('src', 'blob:take');
    expect(onRecorded).toHaveBeenCalledWith(expect.objectContaining({ transcript: '', recognized: false, audio: expect.any(Blob) }));
    expect(screen.getByRole('button', { name: 'Record again' })).toBeInTheDocument();
  });

  it('stops by itself at the maximum length', async () => {
    media = installMedia();
    const onRecorded = vi.fn();
    render(<Recorder text="Hallo" variety="de" maxSeconds={0.05} onRecorded={onRecorded} />);
    fireEvent.click(screen.getByRole('button', { name: 'Record' }));
    await waitFor(() => expect(onRecorded).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('button', { name: 'Stop recording' })).not.toBeInTheDocument();
  });

  it('explains a blocked microphone with steps to fix it', async () => {
    media = installMedia({ getUserMedia: () => Promise.reject(domError('NotAllowedError')) });
    render(<Recorder text="Hallo" variety="de" />);
    fireEvent.click(screen.getByRole('button', { name: 'Record' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Microphone access is blocked for this site.');
    expect(alert).toHaveTextContent('Then reload this page.');
    expect(screen.getByRole('button', { name: 'Record' })).toBeEnabled();
  });

  it('says when no microphone is found', async () => {
    media = installMedia({ getUserMedia: () => Promise.reject(domError('NotFoundError')) });
    render(<Recorder text="Hallo" variety="de" />);
    fireEvent.click(screen.getByRole('button', { name: 'Record' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('No microphone was found');
  });

  it('falls back to listen-and-rate when the browser cannot record', () => {
    media = installMedia({ recorder: false, recognition: false });
    render(<Recorder text="Hallo" variety="de" />);
    expect(screen.getByRole('note')).toHaveTextContent("Recording isn't available in this browser");
    expect(screen.queryByRole('button', { name: 'Record' })).not.toBeInTheDocument();
  });

  it('says "No recording yet" for Swiss German without audio instead of a wrong TTS voice', () => {
    media = installMedia();
    render(<Recorder text="Grüezi mitenand" variety="gsw-zh" />);
    expect(screen.getByText('No recording yet')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Play native/ })).not.toBeInTheDocument();
  });

  it('shadowing: plays the native audio at the chosen speed, then records automatically', async () => {
    media = installMedia();
    render(<Recorder text="Hallo" variety="gsw-zh" nativeUrl="/packs/audio/x.mp3" shadowing />);
    fireEvent.click(screen.getByRole('radio', { name: '0.75×' }));
    expect(screen.getByRole('radio', { name: '0.75×' })).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Listen, then speak' }));
    await screen.findByRole('button', { name: 'Stop recording' });
    expect(FakeAudio.instances[0]).toMatchObject({ src: '/packs/audio/x.mp3', playbackRate: 0.75 });
  });

  it('shadowing with TTS uses the speech rate', async () => {
    media = installMedia();
    render(<Recorder text="Guten Morgen" variety="ch-std" shadowing />);
    fireEvent.click(screen.getByRole('radio', { name: '1.25×' }));
    fireEvent.click(screen.getByRole('button', { name: 'Listen, then speak' }));
    await screen.findByRole('button', { name: 'Stop recording' });
    expect(media.spoken).toEqual([{ text: 'Guten Morgen', rate: 1.25, lang: 'de-CH' }]);
  });

  it('loops a line: after each take it plays the model and records again', async () => {
    media = installMedia();
    render(<Recorder text="Hallo" variety="de" nativeUrl="/a.mp3" shadowing />);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Loop this line' }));
    fireEvent.click(screen.getByRole('button', { name: 'Listen, then speak' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Stop recording' }));
    await waitFor(() => expect(FakeAudio.instances.length).toBe(2), { timeout: 2000 });
    fireEvent.click(await screen.findByRole('button', { name: 'Stop recording' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Stop loop' }));
    await new Promise((r) => setTimeout(r, 1000));
    expect(FakeAudio.instances.length).toBe(2);
  });
});

describe('speech helpers', () => {
  it('maps getUserMedia errors to explainable kinds', () => {
    expect(micErrorKind(domError('NotAllowedError'))).toBe('denied');
    expect(micErrorKind(domError('NotFoundError'))).toBe('no-device');
    expect(micErrorKind(domError('NotReadableError'))).toBe('busy');
    expect(micErrorKind(new Error('x'))).toBe('other');
  });

  it('detects platforms and gives per-platform fixes', () => {
    expect(detectPlatform('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1')).toBe('ios');
    expect(detectPlatform('Mozilla/5.0 (Linux; Android 15; Pixel 7) Chrome/130 Mobile Safari/537.36')).toBe('android');
    expect(detectPlatform('Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0')).toBe('firefox');
    expect(micFixSteps('ios').join(' ')).toMatch(/Settings/);
    expect(micFixSteps('android').join(' ')).toMatch(/Permissions/);
  });

  it('never uses TTS as the native model for Swiss German', () => {
    media = installMedia();
    expect(nativeSource('gsw-be')).toBe('none');
    expect(nativeSource('gsw-be', '/a.mp3')).toBe('audio');
    expect(nativeSource('de')).toBe('tts');
  });

  it('gives longer sentences more recording time, within limits', () => {
    expect(defaultMaxSeconds('Hallo')).toBe(6);
    expect(defaultMaxSeconds('Ich heiße Anna und ich komme aus Zürich in der Schweiz.')).toBeGreaterThan(10);
    expect(defaultMaxSeconds('a '.repeat(100))).toBe(30);
  });
});

describe('LevelMeter and ShadowPanel', () => {
  it('draws a live level from a Web Audio analyser while recording', async () => {
    media = installMedia();
    const close = vi.fn(() => Promise.resolve());
    class FakeCtx {
      resume = () => Promise.resolve();
      close = close;
      createMediaStreamSource = () => ({ connect: vi.fn(), disconnect: vi.fn() });
      createAnalyser = () => ({ fftSize: 0, getByteTimeDomainData: (d: Uint8Array) => d.fill(200) });
    }
    vi.stubGlobal('AudioContext', FakeCtx);
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    render(<Recorder text="Hallo" variety="de" />);
    fireEvent.click(screen.getByRole('button', { name: 'Record' }));
    const meter = await screen.findByRole('meter', { name: 'Microphone level' });
    await waitFor(() => expect(Number(meter.getAttribute('aria-valuenow'))).toBeGreaterThan(50));
    fireEvent.click(screen.getByRole('button', { name: 'Stop recording' }));
    await waitFor(() => expect(close).toHaveBeenCalled());
    getContext.mockRestore();
  });

  it('dialogue shadowing steps through the lines with a fresh recorder each', async () => {
    media = installMedia();
    const { ShadowPanel } = await import('./ShadowPanel');
    render(
      <ShadowPanel
        lines={[
          { speaker: 'Anna', text: 'Hallo, ich bin Anna.', variety: 'de' },
          { speaker: 'Ben', text: 'Hoi Anna.', variety: 'gsw-zh' },
        ]}
      />,
    );
    expect(screen.getByText('Line 1 of 2')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Listen, then speak' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Next line →' }));
    expect(screen.getByText('Line 2 of 2')).toBeInTheDocument();
    // Swiss German line without audio: no model to shadow, recording still works.
    expect(screen.queryByRole('button', { name: 'Listen, then speak' })).not.toBeInTheDocument();
    expect(screen.getByText('No recording yet')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Record' })).toBeInTheDocument();
  });
});
