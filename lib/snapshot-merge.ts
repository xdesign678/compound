import type { Concept, Source } from './types';

function shouldPreserveFullSource(local: Source | undefined, remote: Source): boolean {
  if (!local || local.contentStatus !== 'full') return false;
  return local.ingestedAt === remote.ingestedAt && local.externalKey === remote.externalKey;
}

function shouldPreserveFullConcept(local: Concept | undefined, remote: Concept): boolean {
  if (!local || local.contentStatus !== 'full') return false;
  return local.updatedAt === remote.updatedAt && local.version === remote.version;
}

export function mergeRemoteSource(local: Source | undefined, remote: Source): Source {
  if (!local) return remote;
  if (remote.ingestedAt < local.ingestedAt) return local;
  if (shouldPreserveFullSource(local, remote)) {
    return {
      ...remote,
      rawContent: local.rawContent,
      contentStatus: 'full',
    };
  }
  return remote;
}

export function mergeRemoteConcept(local: Concept | undefined, remote: Concept): Concept {
  if (!local) return remote;
  if (remote.updatedAt < local.updatedAt) return local;
  if (shouldPreserveFullConcept(local, remote)) {
    return {
      ...remote,
      body: local.body,
      contentStatus: 'full',
    };
  }
  return remote;
}
