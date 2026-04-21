import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeRemoteConcept, mergeRemoteSource } from './snapshot-merge';
import type { Concept, Source } from './types';

test('preserves full local concept body when remote snapshot only has summary content', () => {
  const local: Concept = {
    id: 'c-1',
    title: '记忆',
    summary: '旧摘要',
    body: '完整正文',
    sources: ['s-1'],
    related: ['c-2'],
    createdAt: 10,
    updatedAt: 20,
    version: 3,
    contentStatus: 'full',
    categories: [],
    categoryKeys: [],
  };

  const remote: Concept = {
    ...local,
    summary: '新摘要',
    body: '',
    contentStatus: 'partial',
  };

  assert.deepEqual(mergeRemoteConcept(local, remote), {
    ...remote,
    body: '完整正文',
    contentStatus: 'full',
  });
});

test('accepts newer remote concept snapshot when local copy is stale', () => {
  const local: Concept = {
    id: 'c-1',
    title: '记忆',
    summary: '旧摘要',
    body: '旧正文',
    sources: ['s-1'],
    related: [],
    createdAt: 10,
    updatedAt: 20,
    version: 2,
    contentStatus: 'full',
    categories: [],
    categoryKeys: [],
  };

  const remote: Concept = {
    ...local,
    summary: '新摘要',
    body: '',
    updatedAt: 21,
    version: 3,
    contentStatus: 'partial',
  };

  assert.equal(mergeRemoteConcept(local, remote), remote);
});

test('preserves full local source raw content when remote snapshot matches same version', () => {
  const local: Source = {
    id: 's-1',
    title: '原文',
    type: 'file',
    rawContent: '完整原文',
    ingestedAt: 20,
    contentStatus: 'full',
    externalKey: 'github:repo:file@sha1',
  };

  const remote: Source = {
    ...local,
    rawContent: '',
    contentStatus: 'partial',
  };

  assert.deepEqual(mergeRemoteSource(local, remote), {
    ...remote,
    rawContent: '完整原文',
    contentStatus: 'full',
  });
});
