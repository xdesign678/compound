export type ConceptTitleCandidate = {
  title: string;
};

export function pickStableConceptTitles(
  concepts: ConceptTitleCandidate[],
  limit: number = 3,
): string[] {
  return concepts
    .map((concept) => concept.title.trim())
    .filter(Boolean)
    .slice(0, Math.max(0, Math.trunc(limit)));
}
