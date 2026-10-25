import type { ReactNode } from 'react';
import type { Variety } from '@doppelpunkt/content-schema';
import { VARIETY_META } from '../lib/varieties';
import { VarietyTag } from './VarietyTag';
import { AudioButton } from './AudioButton';

type Props = {
  text: string;
  variety: Variety;
  /** Shows a listen button (recording URL or TTS). */
  audio?: boolean | string;
  className?: string;
  children?: ReactNode;
  as?: 'p' | 'span' | 'div';
};

/** A German sentence with its variety tag and the right lang attribute for screen readers. */
export function GermanText({ text, variety, audio, className = '', children, as: Tag = 'p' }: Props) {
  return (
    <Tag className={`flex items-start gap-2 ${className}`}>
      <VarietyTag variety={variety} className="mt-1" />
      <span lang={VARIETY_META[variety].lang} className="min-w-0 flex-1">
        {text}
        {children}
      </span>
      {audio && <AudioButton text={text} variety={variety} url={typeof audio === 'string' ? audio : undefined} />}
    </Tag>
  );
}
