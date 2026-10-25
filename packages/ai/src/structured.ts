import type { ZodTypeAny } from 'zod';
import { AiError, PROVIDER_LABELS, type ChatMessage, type ChatOptions, type ProviderId, type SchemaOf, type StructuredOptions, type Usage } from './types';

/** Best-effort TypeScript-like description of a zod (v3) schema, used to tell the model what JSON to produce. */
export function describeSchema(schema: ZodTypeAny, indent = ''): string {
  const def = (schema as { _def: Record<string, unknown> & { typeName?: string; description?: string } })._def;
  const desc = def.description ? ` /* ${def.description} */` : '';
  const next = indent + '  ';
  switch (def.typeName) {
    case 'ZodString': return 'string' + desc;
    case 'ZodNumber': {
      const checks = (def.checks as { kind: string }[] | undefined) ?? [];
      return (checks.some((c) => c.kind === 'int') ? 'integer' : 'number') + desc;
    }
    case 'ZodBoolean': return 'boolean' + desc;
    case 'ZodNull': return 'null';
    case 'ZodAny': case 'ZodUnknown': return 'any' + desc;
    case 'ZodLiteral': return JSON.stringify(def.value) + desc;
    case 'ZodEnum': return (def.values as string[]).map((v) => JSON.stringify(v)).join(' | ') + desc;
    case 'ZodArray': {
      const inner = describeSchema(def.type as ZodTypeAny, indent);
      return (/[|\n]/.test(inner) ? `Array<${inner}>` : `${inner}[]`) + desc;
    }
    case 'ZodTuple': return `[${(def.items as ZodTypeAny[]).map((i) => describeSchema(i, indent)).join(', ')}]` + desc;
    case 'ZodRecord': return `{ [key: string]: ${describeSchema(def.valueType as ZodTypeAny, indent)} }` + desc;
    case 'ZodOptional': return describeSchema(def.innerType as ZodTypeAny, indent) + ' (optional)';
    case 'ZodNullable': return describeSchema(def.innerType as ZodTypeAny, indent) + ' | null';
    case 'ZodDefault': return describeSchema(def.innerType as ZodTypeAny, indent) + ' (optional)';
    case 'ZodEffects': return describeSchema(def.schema as ZodTypeAny, indent);
    case 'ZodBranded': case 'ZodReadonly': case 'ZodCatch': return describeSchema((def.type ?? def.innerType) as ZodTypeAny, indent);
    case 'ZodPipeline': return describeSchema(def.in as ZodTypeAny, indent);
    case 'ZodLazy': return 'any';
    case 'ZodUnion': case 'ZodDiscriminatedUnion': {
      const opts = (Array.isArray(def.options) ? def.options : [...(def.options as Map<unknown, ZodTypeAny>).values()]) as ZodTypeAny[];
      return opts.map((o) => describeSchema(o, indent)).join(`\n${indent}| `);
    }
    case 'ZodObject': {
      const shape = (typeof def.shape === 'function' ? (def.shape as () => Record<string, ZodTypeAny>)() : def.shape) as Record<string, ZodTypeAny>;
      const lines = Object.entries(shape).map(([k, v]) => {
        const inner = v as ZodTypeAny;
        const opt = inner.isOptional();
        const d = describeSchema(inner, next).replace(/ \(optional\)$/, '');
        return `${next}${JSON.stringify(k)}${opt ? '?' : ''}: ${d}`;
      });
      return `{\n${lines.join(',\n')}\n${indent}}` + desc;
    }
    default: return 'any';
  }
}

/** Pulls a JSON value out of a model reply: strips ``` fences and surrounding prose. */
export function extractJson(text: string): unknown {
  let t = text.trim();
  const fence = t.match(/```(?:json|JSON)?\s*\n?([\s\S]*?)```/);
  if (fence?.[1]) t = fence[1].trim();
  try { return JSON.parse(t); } catch { /* fall through */ }
  const starts = [t.indexOf('{'), t.indexOf('[')].filter((i) => i >= 0);
  if (!starts.length) throw new SyntaxError('No JSON object found in the reply');
  const start = Math.min(...starts);
  const close = t[start] === '{' ? '}' : ']';
  const end = t.lastIndexOf(close);
  if (end <= start) throw new SyntaxError('Unterminated JSON in the reply');
  return JSON.parse(t.slice(start, end + 1));
}

export function jsonInstruction(schema: ZodTypeAny, override?: string): string {
  return [
    'Respond with a single JSON value and nothing else: no prose, no markdown, no code fences.',
    'It must match this shape (TypeScript notation; fields marked ? or (optional) may be omitted):',
    override ?? describeSchema(schema),
  ].join('\n');
}

type ChatFn = (msgs: ChatMessage[], opts: ChatOptions & { json?: boolean }) => Promise<{ text: string; usage: Usage }>;

function formatZodError(e: unknown): string {
  const issues = (e as { issues?: { path: (string | number)[]; message: string }[] }).issues;
  if (!issues) return String(e);
  return issues.slice(0, 10).map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ');
}

/** Shared structured-output loop: ask for JSON, validate with zod, retry once with the error, then throw AiError. */
export async function runStructured<T>(
  provider: ProviderId,
  chat: ChatFn,
  msgs: ChatMessage[],
  schema: SchemaOf<T>,
  opts: StructuredOptions = {},
): Promise<{ data: T; usage: Usage }> {
  const { schemaDescription, ...chatOpts } = opts;
  const instruction = jsonInstruction(schema as unknown as ZodTypeAny, schemaDescription);
  const convo: ChatMessage[] = [...msgs, { role: 'system', content: instruction }];
  const usage: Usage = { inputTokens: 0, outputTokens: 0 };
  let lastError = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await chat(convo, { maxTokens: 4096, ...chatOpts, json: true });
    usage.inputTokens += res.usage.inputTokens;
    usage.outputTokens += res.usage.outputTokens;
    let parsed: unknown;
    try {
      parsed = extractJson(res.text);
    } catch (e) {
      lastError = `The reply was not valid JSON (${(e as Error).message}).`;
      convo.push({ role: 'assistant', content: res.text }, { role: 'user', content: `${lastError} Reply again with only the corrected JSON.` });
      continue;
    }
    const v = schema.safeParse(parsed);
    if (v.success) return { data: v.data, usage };
    lastError = `The JSON did not match the required shape: ${formatZodError(v.error)}.`;
    convo.push({ role: 'assistant', content: res.text }, { role: 'user', content: `${lastError} Reply again with only the corrected JSON.` });
  }
  throw new AiError('bad_response', `${PROVIDER_LABELS[provider]} did not return the expected structured answer. Try again, or try a different model.`, { provider, detail: lastError });
}
