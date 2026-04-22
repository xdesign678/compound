import type { Concept, ContentStatus, Source } from './types';

function hasNonEmptyText(value: string | null | undefined): boolean {
  return Boolean(value?.trim());
}

export function inferContentStatusFromText(value: string | null | undefined): ContentStatus {
  return hasNonEmptyText(value) ? 'full' : 'partial';
}

export function hasConceptBodyContent(
  concept: Pick<Concept, 'body' | 'contentStatus'> | null | undefined
): boolean {
  if (!concept) return false;
  return concept.contentStatus === 'full' || hasNonEmptyText(concept.body);
}

export function hasSourceRawContent(
  source: Pick<Source, 'rawContent' | 'contentStatus'> | null | undefined
): boolean {
  if (!source) return false;
  return source.contentStatus === 'full' || hasNonEmptyText(source.rawContent);
}
