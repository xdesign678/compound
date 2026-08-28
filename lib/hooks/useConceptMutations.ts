'use client';

import { useCallback, useState } from 'react';
import {
  deleteConcept,
  fetchConceptById,
  flagConceptIncorrect,
  isRevisionConflictError,
  requireExpectedRevision,
  type DeleteConceptResponse,
  type FlagConceptIncorrectResponse,
} from '../api-client';
import { getDb } from '../db';
import type { ActivityLog, Concept } from '../types';

export const FLAG_CONFLICT_MESSAGE = '服务器版本已变化，未写入标记';
export const DELETE_CONFLICT_MESSAGE = '服务器版本已变化，未删除本地概念';

export interface ConceptMutationAdapters {
  fetchConceptById: (id: string) => Promise<Concept>;
  flagConceptIncorrect: (input: {
    id: string;
    expectedRevision: number;
  }) => Promise<FlagConceptIncorrectResponse>;
  deleteConcept: (input: {
    id: string;
    expectedRevision: number;
  }) => Promise<DeleteConceptResponse>;
  persistConcept: (concept: Concept) => Promise<void>;
  persistActivity: (activity: ActivityLog) => Promise<void>;
  deleteLocalConcept: (id: string) => Promise<void>;
}

export function conceptMutationErrorMessage(
  err: unknown,
  conflictMessage: string,
  fallback: string,
): string {
  if (isRevisionConflictError(err)) return conflictMessage;
  if (err instanceof Error) return err.message;
  return fallback;
}

export function conceptFlagToastMessage(created: boolean): string {
  return created ? '已标记为有误' : '已在审核队列中';
}

function defaultAdapters(): ConceptMutationAdapters {
  return {
    fetchConceptById,
    flagConceptIncorrect,
    deleteConcept,
    persistConcept: async (concept) => {
      await getDb().concepts.put(concept);
    },
    persistActivity: async (activity) => {
      await getDb().activity.put(activity);
    },
    deleteLocalConcept: async (id) => {
      await getDb().concepts.delete(id);
    },
  };
}

export async function refreshConceptFromServer(
  id: string,
  adapters: ConceptMutationAdapters = defaultAdapters(),
): Promise<Concept> {
  const remote = await adapters.fetchConceptById(id);
  await adapters.persistConcept({
    ...remote,
    contentStatus: remote.contentStatus ?? 'full',
  });
  return remote;
}

export async function flagConceptWithCas(
  id: string,
  adapters: ConceptMutationAdapters = defaultAdapters(),
): Promise<{ created: boolean }> {
  const remote = await refreshConceptFromServer(id, adapters);
  const result = await adapters.flagConceptIncorrect({
    id,
    expectedRevision: requireExpectedRevision(remote.serverRevision),
  });
  if (result.activity) {
    await adapters.persistActivity(result.activity);
  }
  return { created: result.created };
}

export async function deleteConceptWithCas(
  id: string,
  adapters: ConceptMutationAdapters = defaultAdapters(),
): Promise<void> {
  const remote = await refreshConceptFromServer(id, adapters);
  await adapters.deleteConcept({
    id,
    expectedRevision: requireExpectedRevision(remote.serverRevision),
  });
  await adapters.deleteLocalConcept(id);
}

export function useConceptMutations({
  id,
  showToast,
  showErrorToast,
  back,
}: {
  id: string;
  showToast: (text: string) => void;
  showErrorToast: (text: string) => void;
  back: () => void;
}) {
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [flagging, setFlagging] = useState(false);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const handleRefreshConcept = useCallback(async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await refreshConceptFromServer(id);
      setMutationError(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : '刷新失败';
      setMutationError(message);
      showErrorToast(message);
    } finally {
      setRefreshing(false);
    }
  }, [id, refreshing, showErrorToast]);

  const handleFlagConcept = useCallback(async () => {
    if (flagging) return;
    setFlagging(true);
    setMutationError(null);
    try {
      const result = await flagConceptWithCas(id);
      showToast(conceptFlagToastMessage(result.created));
    } catch (err) {
      const message = conceptMutationErrorMessage(err, FLAG_CONFLICT_MESSAGE, '标记失败');
      setMutationError(message);
      showErrorToast(message);
    } finally {
      setFlagging(false);
    }
  }, [flagging, id, showErrorToast, showToast]);

  const handleDeleteConcept = useCallback(async () => {
    if (deleting) return;
    setDeleting(true);
    setMutationError(null);
    try {
      await deleteConceptWithCas(id);
      showToast('概念已删除');
      back();
    } catch (err) {
      const message = conceptMutationErrorMessage(err, DELETE_CONFLICT_MESSAGE, '删除失败');
      setMutationError(message);
      showErrorToast(message);
    } finally {
      setDeleting(false);
      setShowDeleteConfirm(false);
    }
  }, [back, deleting, id, showErrorToast, showToast]);

  return {
    showDeleteConfirm,
    setShowDeleteConfirm,
    deleting,
    flagging,
    mutationError,
    refreshing,
    handleRefreshConcept,
    handleFlagConcept,
    handleDeleteConcept,
  };
}
