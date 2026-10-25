import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { ChatMessage, Provider, Usage } from '@doppelpunkt/ai';
import { estimateCost } from '@doppelpunkt/ai';
import { errorMessage } from '../lib/ai';
import { UmlautBar } from '../exercise/UmlautBar';

type Props = {
  provider: Provider;
  system: string;
  /** Optional first user turn sent automatically (e.g. "start the role-play"). */
  opener?: string;
  onTurn?: (messages: ChatMessage[]) => void;
  onCost?: (usd: number) => void;
  placeholder?: string;
};

/** Streaming chat with a tutor. Messages stay in memory for this screen only. */
export function ChatPanel({ provider, system, opener, onTurn, onCost, placeholder = 'Schreib auf Deutsch …' }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const abort = useRef<AbortController | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const started = useRef(false);

  useEffect(() => () => abort.current?.abort(), []);
  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: 'end' });
  }, [messages]);

  const send = async (text: string, history: ChatMessage[]) => {
    const userMsg: ChatMessage = { role: 'user', content: text };
    const convo = [...history, userMsg];
    setMessages([...convo, { role: 'assistant', content: '' }]);
    setBusy(true);
    setError(undefined);
    const ctrl = new AbortController();
    abort.current = ctrl;
    let reply = '';
    try {
      const onUsage = (u: Usage) => onCost?.(estimateCost(provider.id, provider.model, u));
      for await (const chunk of provider.stream([{ role: 'system', content: system }, ...convo], { signal: ctrl.signal, onUsage })) {
        reply += chunk;
        setMessages([...convo, { role: 'assistant', content: reply }]);
      }
      const final = [...convo, { role: 'assistant' as const, content: reply }];
      setMessages(final);
      onTurn?.(final);
    } catch (e) {
      if (!ctrl.signal.aborted) setError(errorMessage(e));
      setMessages(reply ? [...convo, { role: 'assistant', content: reply }] : convo);
    } finally {
      setBusy(false);
      abort.current = null;
    }
  };

  useEffect(() => {
    if (opener && !started.current) {
      started.current = true;
      void send(opener, []);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opener]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const text = draft.trim();
    if (!text || busy) return;
    setDraft('');
    void send(text, messages);
  };

  const visible = opener ? messages.slice(1) : messages;

  return (
    <div className="flex flex-col gap-3">
      {/* role=log is polite; aria-busy while streaming so screen readers read the finished reply once, not every chunk. */}
      <div
        className="max-h-[55dvh] min-h-48 space-y-3 overflow-y-auto rounded-2xl border border-line bg-surface-2 p-3"
        role="log"
        aria-live="polite"
        aria-busy={busy}
        aria-label="Conversation"
        tabIndex={0}
      >
        {visible.length === 0 && <p className="text-sm text-muted">Say hallo to start.</p>}
        {visible.map((m, i) => (
          <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <p
              lang="de"
              className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-base ${
                m.role === 'user' ? 'bg-ink text-white dark:bg-accent dark:text-ink' : 'bg-surface text-fg'
              }`}
            >
              {m.content || (busy ? '…' : '')}
            </p>
          </div>
        ))}
        <div ref={endRef} />
      </div>
      {error && (
        <p role="alert" className="rounded-xl bg-bad-soft p-3 text-sm text-bad">
          {error}
        </p>
      )}
      <form onSubmit={submit} className="flex gap-2">
        <label htmlFor="chat-input" className="sr-only">
          Message
        </label>
        <textarea
          ref={inputRef}
          id="chat-input"
          rows={2}
          className="input flex-1 resize-none"
          value={draft}
          placeholder={placeholder}
          lang="de"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) submit(e);
          }}
        />
        {busy ? (
          <button type="button" className="btn-secondary" onClick={() => abort.current?.abort()}>
            Stop
          </button>
        ) : (
          <button type="submit" className="btn-primary" disabled={!draft.trim()}>
            Send
          </button>
        )}
      </form>
      <UmlautBar target={() => inputRef.current} onInsert={setDraft} />
    </div>
  );
}
