import { Exercise } from '@doppelpunkt/content-schema';

/** Build a valid exercise with defaults applied (prompt/explanation/skill filled in). */
export function ex(partial: Record<string, unknown>): Exercise {
  return Exercise.parse({ id: 'x-1', skill: 'grammar', prompt: 'Do it.', explanation: 'Because.', ...partial });
}
