import type { SourceType } from '../../lib/types';

export type MentionKind = 'concept' | 'source';

export type MentionItem = {
  id: string;
  kind: MentionKind;
  title: string;
  subtitle: string;
  type?: SourceType;
};

export type InlineMention = {
  start: number;
  end: number;
  query: string;
};

export type ModelOption = {
  label: string;
  value: string;
  helper?: string;
};
