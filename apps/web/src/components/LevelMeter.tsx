import { useEffect, useRef } from 'react';

type AudioCtor = typeof AudioContext;

function audioContextCtor(): AudioCtor | undefined {
  if (typeof window === 'undefined') return undefined;
  const w = window as unknown as { AudioContext?: AudioCtor; webkitAudioContext?: AudioCtor };
  return w.AudioContext ?? w.webkitAudioContext;
}

/**
 * Live waveform and input level of a microphone stream (Web Audio AnalyserNode on a canvas).
 * Without Web Audio (old browsers, tests) it shows a pulsing dot instead.
 */
export function LevelMeter({ stream, className = '' }: { stream?: MediaStream; className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const barRef = useRef<HTMLSpanElement>(null);
  const Ctor = audioContextCtor();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!stream || !Ctor || !canvas || !stream.getAudioTracks().length) return;
    let ctx: AudioContext;
    try {
      ctx = new Ctor();
    } catch {
      return;
    }
    void ctx.resume?.().catch(() => undefined);
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    source.connect(analyser);
    const data = new Uint8Array(analyser.fftSize);
    const g = canvas.getContext('2d');
    let raf = 0;

    const draw = () => {
      analyser.getByteTimeDomainData(data);
      let sum = 0;
      for (const v of data) sum += ((v - 128) / 128) ** 2;
      const rms = Math.sqrt(sum / data.length);
      const level = Math.min(1, rms * 4);
      if (barRef.current) {
        barRef.current.style.width = `${Math.round(level * 100)}%`;
        barRef.current.parentElement?.setAttribute('aria-valuenow', String(Math.round(level * 100)));
      }
      if (g) {
        const { width, height } = canvas;
        const styles = getComputedStyle(canvas);
        g.clearRect(0, 0, width, height);
        g.lineWidth = 2 * (window.devicePixelRatio || 1);
        g.strokeStyle = styles.color || '#c0392b';
        g.beginPath();
        const step = width / data.length;
        data.forEach((v, i) => {
          const y = (v / 255) * height;
          if (i === 0) g.moveTo(0, y);
          else g.lineTo(i * step, y);
        });
        g.stroke();
      }
      raf = requestAnimationFrame(draw);
    };
    // Match the canvas to its CSS size for a crisp line.
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(canvas.clientWidth * dpr));
    canvas.height = Math.max(1, Math.round(canvas.clientHeight * dpr));
    draw();

    return () => {
      cancelAnimationFrame(raf);
      source.disconnect();
      void ctx.close().catch(() => undefined);
    };
  }, [stream, Ctor]);

  if (!Ctor || !stream) {
    return (
      <span className={`inline-flex items-center gap-2 text-sm text-swiss-strong ${className}`}>
        <span aria-hidden="true" className="h-2.5 w-2.5 animate-pulse rounded-full bg-swiss" />
        Listening…
      </span>
    );
  }
  return (
    <div className={`space-y-1 ${className}`}>
      <canvas ref={canvasRef} aria-hidden="true" className="h-12 w-full rounded-lg bg-swiss-soft text-swiss" />
      <div role="meter" aria-label="Microphone level" aria-valuemin={0} aria-valuemax={100} aria-valuenow={0} className="h-1.5 overflow-hidden rounded-full bg-surface-2">
        <span ref={barRef} className="block h-full w-0 bg-swiss transition-[width] duration-75" />
      </div>
    </div>
  );
}
