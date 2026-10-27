import assert from 'node:assert/strict';
import test from 'node:test';

import type { AISession } from '../../infrastructure/ai/types';
import {
  DebouncedBackupMirror,
  isEmptySessionsStore,
  mergeImportedSessions,
  parseBackupSessions,
  shouldRestoreFromBackup,
} from './aiSessionsBackup';

function makeSession(id: string, updatedAt = 1_000): AISession {
  return {
    id,
    title: id,
    agentId: 'catty',
    scope: { type: 'workspace', targetId: 'ws-1' },
    messages: [],
    createdAt: updatedAt,
    updatedAt,
  } as never;
}

test('isEmptySessionsStore treats missing, empty, and corrupt stores as empty', () => {
  assert.equal(isEmptySessionsStore(null), true);
  assert.equal(isEmptySessionsStore(''), true);
  assert.equal(isEmptySessionsStore('[]'), true);
  assert.equal(isEmptySessionsStore('{corrupt'), true);
  assert.equal(isEmptySessionsStore('[{"id":"s1"}]'), false);
});

test('parseBackupSessions ignores corrupt payloads and drops malformed entries', () => {
  assert.equal(parseBackupSessions(null), null);
  assert.equal(parseBackupSessions(''), null);
  assert.equal(parseBackupSessions('not json'), null);
  assert.equal(parseBackupSessions('{"id":"s1"}'), null);
  const sessions = parseBackupSessions(JSON.stringify([
    { id: 's1' },
    { nope: true },
    null,
    { id: 's2' },
  ]));
  assert.deepEqual(sessions?.map((session) => session.id), ['s1', 's2']);
});

test('restore happens only on an empty live store with a non-empty backup', () => {
  const backup = JSON.stringify([makeSession('s1')]);
  // Empty (or wiped) store -> restore.
  assert.equal(shouldRestoreFromBackup(null, backup), true);
  assert.equal(shouldRestoreFromBackup('[]', backup), true);
  assert.equal(shouldRestoreFromBackup('{corrupt', backup), true);
  // Non-empty live store -> never restore (explicit deletions must win).
  assert.equal(shouldRestoreFromBackup('[{"id":"live"}]', backup), false);
  // Empty/corrupt backup -> nothing to restore.
  assert.equal(shouldRestoreFromBackup(null, null), false);
  assert.equal(shouldRestoreFromBackup(null, '[]'), false);
  assert.equal(shouldRestoreFromBackup(null, '{corrupt'), false);
});

test('mergeImportedSessions keys by id with the newer updatedAt winning', () => {
  const current = [makeSession('keep', 100), makeSession('older', 100)];
  const imported = [makeSession('newer', 200), makeSession('older', 50), makeSession('added', 1)];
  const merged = mergeImportedSessions(current, imported);
  const byId = new Map(merged.map((session) => [session.id, session]));
  assert.equal(byId.get('older')?.updatedAt, 100);
  assert.equal(byId.get('newer')?.updatedAt, 200);
  assert.equal(byId.has('added'), true);
  assert.equal(byId.has('keep'), true);
  // Sorted newest-first for stable history ordering.
  assert.deepEqual(
    merged.map((session) => session.updatedAt),
    [...merged.map((session) => session.updatedAt)].sort((a, b) => b - a),
  );
});

test('DebouncedBackupMirror writes once per batch with the last payload', async () => {
  const writes: string[] = [];
  const mirror = new DebouncedBackupMirror((json) => writes.push(json), 15);
  mirror.schedule('{"gen":1}');
  mirror.schedule('{"gen":2}');
  await new Promise((resolve) => setTimeout(resolve, 30));
  mirror.schedule('{"gen":3}');
  mirror.schedule('{"gen":4}');
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.deepEqual(writes, ['{"gen":2}', '{"gen":4}']);
});

test('DebouncedBackupMirror flushNow writes the pending payload immediately', () => {
  const writes: string[] = [];
  const mirror = new DebouncedBackupMirror((json) => writes.push(json), 60_000);
  mirror.schedule('{"gen":1}');
  mirror.flushNow();
  assert.deepEqual(writes, ['{"gen":1}']);
  // A second flush with nothing pending is a no-op.
  mirror.flushNow();
  assert.deepEqual(writes, ['{"gen":1}']);
});
