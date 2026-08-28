import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MissingExpectedRevisionError,
  RevisionConflictError,
  type DeleteConceptResponse,
  type FlagConceptIncorrectResponse,
} from '../api-client';
import type { ActivityLog, Concept } from '../types';
import {
  conceptFlagToastMessage,
  conceptMutationErrorMessage,
  DELETE_CONFLICT_MESSAGE,
  deleteConceptWithCas,
  FLAG_CONFLICT_MESSAGE,
  flagConceptWithCas,
  refreshConceptFromServer,
  type ConceptMutationAdapters,
} from './useConceptMutations';

function conceptFixture(overrides: Partial<Concept> = {}): Concept {
  return {
    id: 'c-1',
    title: 'Wiki',
    summary: '',
    body: 'body',
    sources: [],
    related: [],
    createdAt: 1,
    updatedAt: 1,
    version: 1,
    categories: [],
    categoryKeys: [],
    ...overrides,
  };
}

function activityFixture(overrides: Partial<ActivityLog> = {}): ActivityLog {
  return {
    id: 'a-server-1',
    type: 'lint',
    title: '标记有误：Wiki',
    details: 'server queue',
    status: 'success',
    relatedConceptIds: ['c-1'],
    at: 1,
    ...overrides,
  };
}

function createAdapters(remote: Concept): {
  adapters: ConceptMutationAdapters;
  persistedConcepts: Concept[];
  persistedActivities: ActivityLog[];
  deletedIds: string[];
  flagCalls: Array<{ id: string; expectedRevision: number }>;
  deleteCalls: Array<{ id: string; expectedRevision: number }>;
} {
  const persistedConcepts: Concept[] = [];
  const persistedActivities: ActivityLog[] = [];
  const deletedIds: string[] = [];
  const flagCalls: Array<{ id: string; expectedRevision: number }> = [];
  const deleteCalls: Array<{ id: string; expectedRevision: number }> = [];

  const adapters: ConceptMutationAdapters = {
    fetchConceptById: async () => remote,
    flagConceptIncorrect: async (input) => {
      flagCalls.push(input);
      return {
        created: true,
        review: {
          id: 'rv-1',
          kind: 'concept_incorrect',
          status: 'open',
          title: '标记有误：Wiki',
          target_id: input.id,
          created_at: 1,
          updated_at: 1,
        },
        activity: activityFixture(),
      } satisfies FlagConceptIncorrectResponse;
    },
    deleteConcept: async (input) => {
      deleteCalls.push(input);
      return { deleted: true, idempotent: false } satisfies DeleteConceptResponse;
    },
    persistConcept: async (concept) => {
      persistedConcepts.push(concept);
    },
    persistActivity: async (activity) => {
      persistedActivities.push(activity);
    },
    deleteLocalConcept: async (id) => {
      deletedIds.push(id);
    },
  };

  return {
    adapters,
    persistedConcepts,
    persistedActivities,
    deletedIds,
    flagCalls,
    deleteCalls,
  };
}

test('preflight persists the fetched serverRevision and never invents 1', async () => {
  const remote = conceptFixture({ serverRevision: 5, contentStatus: 'partial' });
  const { adapters, persistedConcepts, flagCalls } = createAdapters(remote);

  const refreshed = await refreshConceptFromServer(remote.id, adapters);

  assert.equal(refreshed.serverRevision, 5);
  assert.equal(persistedConcepts[0]?.serverRevision, 5);
  assert.equal(persistedConcepts[0]?.contentStatus, 'partial');
  assert.equal(flagCalls.length, 0);
});

test('flag CAS refuses a missing serverRevision instead of guessing 1', async () => {
  const { adapters, flagCalls, persistedActivities } = createAdapters(conceptFixture());

  await assert.rejects(() => flagConceptWithCas('c-1', adapters), MissingExpectedRevisionError);
  assert.equal(flagCalls.length, 0);
  assert.equal(persistedActivities.length, 0);
});

test('flag CAS sends the preflight token and reuses server activity', async () => {
  const { adapters, flagCalls, persistedActivities } = createAdapters(
    conceptFixture({ serverRevision: 5 }),
  );

  const result = await flagConceptWithCas('c-1', adapters);

  assert.equal(result.created, true);
  assert.deepEqual(flagCalls, [{ id: 'c-1', expectedRevision: 5 }]);
  assert.equal(persistedActivities.length, 1);
  assert.equal(persistedActivities[0]?.id, 'a-server-1');
  assert.equal(
    persistedActivities.some((item) => item.id.startsWith('flag-c-1-')),
    false,
  );
});

test('flag CAS does not fabricate activity when the server returns none', async () => {
  const harness = createAdapters(conceptFixture({ serverRevision: 2 }));
  harness.adapters.flagConceptIncorrect = async (input) => {
    harness.flagCalls.push(input);
    return {
      created: false,
      review: {
        id: 'rv-open',
        kind: 'concept_incorrect',
        status: 'open',
        title: '标记有误：Wiki',
        target_id: input.id,
        created_at: 1,
        updated_at: 1,
      },
      activity: null,
    };
  };

  const result = await flagConceptWithCas('c-1', harness.adapters);

  assert.equal(result.created, false);
  assert.equal(conceptFlagToastMessage(result.created), '已在审核队列中');
  assert.equal(harness.persistedActivities.length, 0);
});

test('delete CAS removes Dexie only after a 2xx delete', async () => {
  const { adapters, deleteCalls, deletedIds } = createAdapters(
    conceptFixture({ serverRevision: 4 }),
  );

  await deleteConceptWithCas('c-1', adapters);

  assert.deepEqual(deleteCalls, [{ id: 'c-1', expectedRevision: 4 }]);
  assert.deepEqual(deletedIds, ['c-1']);
});

test('delete CAS keeps the local concept on 409', async () => {
  const harness = createAdapters(conceptFixture({ serverRevision: 4 }));
  harness.adapters.deleteConcept = async () => {
    throw new RevisionConflictError(4, 5);
  };

  await assert.rejects(
    () => deleteConceptWithCas('c-1', harness.adapters),
    (err: unknown) => err instanceof RevisionConflictError,
  );
  assert.deepEqual(harness.deletedIds, []);
  assert.equal(
    conceptMutationErrorMessage(
      new RevisionConflictError(4, 5),
      DELETE_CONFLICT_MESSAGE,
      '删除失败',
    ),
    DELETE_CONFLICT_MESSAGE,
  );
});

test('conflict copy is specific and generic errors keep their message', () => {
  assert.equal(
    conceptMutationErrorMessage(new RevisionConflictError(1, 2), FLAG_CONFLICT_MESSAGE, '标记失败'),
    FLAG_CONFLICT_MESSAGE,
  );
  assert.equal(
    conceptMutationErrorMessage(new Error('认证失败'), FLAG_CONFLICT_MESSAGE, '标记失败'),
    '认证失败',
  );
  assert.equal(conceptMutationErrorMessage('nope', FLAG_CONFLICT_MESSAGE, '标记失败'), '标记失败');
  assert.equal(conceptFlagToastMessage(true), '已标记为有误');
});
