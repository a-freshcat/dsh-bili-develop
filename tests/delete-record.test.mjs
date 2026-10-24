import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fixture, BV } from './fixtures.mjs';

test('deleting a finished record removes only its owned note, keeps quota, dedup and original session', async t => {
  const f = fixture(t); const binding = await f.bind();
  await f.controller.start({ requestId: 'record-to-delete', bvid: BV }); await f.controller.idle();
  const run = f.store.run('record-to-delete'), note = join(f.workspacePath, run.notePath);
  const unrelated = join(f.workspacePath, 'user-document.md'); writeFileSync(unrelated, '用户文档');
  const usage = f.store.budget(f.store.config()).analyses;
  await f.controller.dispatch({ action: 'delete_record', requestId: run.id });
  assert.equal(f.store.run(run.id), null); assert.equal(existsSync(note), false);
  assert.equal(readFileSync(unrelated, 'utf8'), '用户文档'); assert.equal(f.store.seen('123', BV), true);
  assert.equal(f.store.budget(f.store.config()).analyses, usage);
  assert.equal(f.store.get('binding').sessionId, binding.sessionId); assert.equal(f.counters.create, 1);
  await f.controller.dispatch({ action: 'compact_database' });
  assert.equal(f.store.budget(f.store.config()).analyses, usage);
});

test('active/pending and private tasks cannot be removed using history deletion', async t => {
  const f = fixture(t, { noResult: true }); await f.bind();
  await f.controller.start({ requestId: 'record-active', bvid: BV }); await f.controller.idle();
  await assert.rejects(f.controller.dispatch({ action: 'delete_record', requestId: 'record-active' }));
  assert.ok(f.store.run('record-active'));
});
