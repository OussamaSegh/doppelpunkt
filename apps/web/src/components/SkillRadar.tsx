import type { SkillEstimate } from '@doppelpunkt/engine';

const LABELS: Record<SkillEstimate['skill'], string> = {
  reading: 'Reading',
  listening: 'Listening',
  speaking: 'Speaking',
  writing: 'Writing',
  vocabulary: 'Vocabulary',
  grammar: 'Grammar',
  swiss: 'Swiss German',
};

const BANDS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];

/** Maps a band like "A2+" to 0..1 (A1- → ~0, C2 → 1). */
export function bandValue(band: string): number {
  const base = BANDS.indexOf(band.slice(0, 2).toUpperCase());
  if (base < 0) return 0;
  const mod = band.endsWith('+') ? 0.5 : band.endsWith('-') ? -0.25 : 0;
  return Math.max(0, Math.min(1, (base + 1 + mod) / BANDS.length));
}

/** Radar chart of per-skill CEFR bands. Accessible via the table that follows it. */
export function SkillRadar({ skills, size = 280 }: { skills: SkillEstimate[]; size?: number }) {
  const n = skills.length;
  if (n < 3) return null;
  const c = size / 2;
  const r = size / 2 - 44;
  const point = (i: number, v: number) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
    return [c + Math.cos(a) * r * v, c + Math.sin(a) * r * v] as const;
  };
  const poly = (v: (i: number) => number) => skills.map((_, i) => point(i, v(i)).join(',')).join(' ');

  return (
    <figure className="flex flex-col items-center">
      <svg viewBox={`0 0 ${size} ${size}`} width="100%" style={{ maxWidth: size }} role="img" aria-label="Skill radar chart">
        {[1 / 3, 2 / 3, 1].map((ring) => (
          <polygon key={ring} points={poly(() => ring)} fill="none" stroke="var(--dp-border)" strokeWidth={1} />
        ))}
        {skills.map((_, i) => {
          const [x, y] = point(i, 1);
          return <line key={i} x1={c} y1={c} x2={x} y2={y} stroke="var(--dp-border)" strokeWidth={1} />;
        })}
        <polygon
          points={poly((i) => Math.max(0.04, bandValue(skills[i]?.band ?? '')))}
          fill="var(--dp-accent)"
          fillOpacity={0.22}
          stroke="var(--dp-accent)"
          strokeWidth={2}
        />
        {skills.map((s, i) => {
          const [x, y] = point(i, 1.2);
          const swiss = s.skill === 'swiss';
          return (
            <text
              key={s.skill}
              x={x}
              y={y}
              textAnchor={Math.abs(x - c) < 4 ? 'middle' : x > c ? 'start' : 'end'}
              dominantBaseline="middle"
              fontSize={11}
              fill={swiss ? 'var(--dp-swiss)' : 'var(--dp-fg)'}
              opacity={s.attempts ? 1 : 0.55}
            >
              {LABELS[s.skill]} {s.attempts ? s.band : '–'}
            </text>
          );
        })}
      </svg>
    </figure>
  );
}

export function skillLabel(skill: SkillEstimate['skill']): string {
  return LABELS[skill];
}
