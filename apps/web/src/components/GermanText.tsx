import type { ReactNode } from 'react';
import type { Variety } from '@doppelpunkt/content-schema';
import { VARIETY_META } from '../lib/varieties';
import { VarietyTag } from './VarietyTag';
import { AudioButton } from './AudioButton';

type Props = {
  text: string;
  variety: Variety;
  /** Shows a listen button (recording URL, or TTS for Standard German only). */
  audio?: boolean | string;
  className?: string;
  children?: ReactNode;
  as?: 'p' | 'span' | 'div';
};

/** A German sentence with its variety tag and the right lang attribute for screen readers. */
export function GermanText({ text, variety, audio, className = '', children, as: Tag = 'p' }: Props) {
  // TTS voices only speak Standard German: Swiss German gets a listen button only with a recording.
  const url = typeof audio === 'string' ? audio : undefined;
  const listen = !!audio && (!!url || (variety !== 'gsw-zh' && variety !== 'gsw-be'));
  return (
    <Tag className={`flex items-start gap-2 ${className}`}>
      <VarietyTag variety={variety} className="mt-1" />
      <span lang={VARIETY_META[variety].lang} className="min-w-0 flex-1">
        {text}
        {children}
      </span>
      {listen && <AudioButton text={text} variety={variety} url={url} />}
    </Tag>
  );
}
