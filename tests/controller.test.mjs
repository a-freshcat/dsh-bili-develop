import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, rmdirSync } from 'node:fs';
import { join } from 'node:path';
import { fixture, BV } from './fixtures.mjs';
import { Store } from '../src/store.mjs';
import { Controller } from '../src/controller.mjs';

test('history returns compact10-row pages and the final partial page without changing totals', async t => {
  const f = fixture(t); await f.bind();
  for (let i = 0; i < 21; i++) {
    const id = 'history-page-' + i;
    f.store.start({ id, kind: 'probe', sessionId: f.store.get('binding').sessionId }); f.store.update(id, { state: 'completed' });
  }
  const first = await f.controller.status(), second = await f.controller.status({ offset: first.pageSize }), last = await f.controller.status({ offset: first.pageSize * 2 });
  assert.equal(first.pageSize, 10); assert.equal(first.total, 21); assert.equal(first.runs.length, 10);
  assert.equal(second.runs.length, 10); assert.equal(last.runs.length, 1);
  assert.equal(new Set([...first.runs, ...second.runs, ...last.runs].map(r => r.id)).size, 21);
});

test('single-video preview persists SQLite, workspace note and same native dialogue', async t => {
  const f = fixture(t), binding = await f.bind();
  const result = await f.controller.start({ requestId: 'video-test-1', bvid: BV });
  await f.controller.idle();
  const run = f.store.run(result.run.id);
  assert.equal(run.state, 'preview');
  assert.equal(run.sessionId, binding.sessionId);
  assert.equal(run.noteStatus, 'saved');
  assert.match(readFileSync(join(f.workspacePath, run.notePath), 'utf8'), /评论预览（未发送）/);
  const second = new Store(join(f.root, 'state.sqlite'));
  assert.equal(second.run(run.id).preview.summary, '材料摘要');
  second.close();
  const status = await f.controller.status();
  assert.equal(status.mode, 'preview_only');
  assert.equal(status.runs[0].promptText, undefined);
  assert.equal(status.runs[0].evidence.text, undefined);
  assert.equal(f.counters.create, 1);
});
test('duplicate request and retry do not repeat read or model calls', async t => {
  const f = fixture(t); await f.bind();
  const request = { requestId: 'same-request', bvid: BV };
  await Promise.all([f.controller.start(request), f.controller.start(request)]);
  await f.controller.idle();
  assert.equal((await f.controller.start(request)).fresh, false);
  assert.equal(f.counters.read, 1);
  assert.equal(f.counters.prompt, 1);
  await assert.rejects(f.controller.start({ ...request, bvid: 'BV1xx411c7mE' }), { code: 'REQUEST_CONFLICT' });
});
test('two distinct requests enforce one active run and settings stay stable', async t => {
  const f = fixture(t, { noResult: true, neverIdle: true }); await f.bind();
  await f.controller.start({ requestId: 'request-a', bvid: BV });
  await assert.rejects(f.controller.start({ requestId: 'request-b', bvid: BV }), { code: 'RUN_BUSY' });
  assert.throws(() => f.controller.configure({ persona: 'change' }), { code: 'RUN_BUSY' });
  await f.controller.idle();
  assert.equal(f.store.active().state, 'awaiting_model');
});
test('missing subtitles are skipped without invoking model and recorded honestly', async t => {
  const f = fixture(t, { evidence: { text: '', segments: [], coverage: 'none', skipReason: '无可用字幕' } }); await f.bind();
  await f.controller.start({ requestId: 'no-subtitles', bvid: BV }); await f.controller.idle();
  assert.equal(f.store.run('no-subtitles').state, 'skipped');
  assert.equal(f.counters.prompt, 0);
  assert.match(readFileSync(join(f.workspacePath, f.store.run('no-subtitles').notePath), 'utf8'), /无可用字幕/);
});
test('read errors are sanitized and model is never invoked', async t => {
  const f = fixture(t, { readError: true }); await f.bind();
  await f.controller.start({ requestId: 'read-failure', bvid: BV }); await f.controller.idle();
  assert.equal(f.store.run('read-failure').state, 'failed');
  assert.ok(!JSON.stringify(await f.controller.status()).includes('private sensitive'));
  assert.equal(f.counters.prompt, 0);
});
test('invalid model format records failure without publishing a draft', async t => {
  const f = fixture(t, { output: 'not JSON' }); await f.bind();
  await f.controller.start({ requestId: 'bad-output', bvid: BV }); await f.controller.idle();
  assert.equal(f.store.run('bad-output').state, 'failed');
  assert.equal(f.store.run('bad-output').preview, undefined);
});
test('aborted model turn is never accepted even when it contains valid JSON', async t => {
  const f = fixture(t, { aborted: true }); await f.bind();
  await f.controller.start({ requestId: 'aborted-output', bvid: BV }); await f.controller.idle();
  assert.equal(f.store.run('aborted-output').state, 'failed');
  assert.equal(f.store.run('aborted-output').error.code, 'MODEL_INTERRUPTED');
  assert.equal(f.store.run('aborted-output').preview, undefined);
});
test('restart reconciles original durable result without resend or recreate', async t => {
  const f = fixture(t); const binding = await f.bind();
  const run = f.store.start({ id: 'restart-run', kind: 'probe', sessionId: binding.sessionId }).run;
  f.store.update(run.id, { state: 'awaiting_model' });
  await f.host.prompt(run, 'BILI_PROBE_OK ' + run.id);
  const after = new Controller({ store: f.store, host: f.host, reader: () => { throw new Error('must not read'); } });
  await after.recover();
  assert.equal(f.store.run(run.id).state, 'completed');
  assert.equal(f.counters.prompt, 1);
  assert.equal(f.counters.create, 1);
});
test('restart during read marks interruption without executing it again', async t => {
  const f = fixture(t); const binding = await f.bind();
  f.store.start({ id: 'interrupted-run', kind: 'video', bvid: BV, sessionId: binding.sessionId });
  await f.controller.recover();
  assert.equal(f.store.run('interrupted-run').state, 'interrupted');
  assert.equal(f.counters.read, 0);
  assert.equal(f.counters.prompt, 0);
});
test('filesystem failure preserves completed database result and allows note retry', async t => {
  const f = fixture(t); await f.bind();
  mkdirSync(join(f.workspacePath, '.bilibili-harness', 'notes', 'note-failure.md'), { recursive: true });
  await f.controller.start({ requestId: 'note-failure', bvid: BV }); await f.controller.idle();
  const run = f.store.run('note-failure');
  assert.equal(run.state, 'preview');
  assert.equal(run.noteStatus, 'failed');
  assert.ok(run.preview);
  rmdirSync(join(f.workspacePath, '.bilibili-harness', 'notes', 'note-failure.md'));
  const retried = f.controller.retryNote(run.id).run;
  assert.equal(retried.noteStatus, 'saved');
  assert.equal(f.counters.prompt, 1);
});
test('comment, message and dynamic send actions are absent', async t => {
  const f = fixture(t);
  for (const action of ['send_comment', 'reply_dm', 'publish_dynamic', 'execute']) {
    await assert.rejects(f.controller.dispatch({ action }), { code: 'UNKNOWN_ACTION' });
  }
});
test('reader environment check records visible readiness in status', async t => {
  const f = fixture(t);
  await f.controller.dispatch({ action: 'reader_ping' });
  assert.equal((await f.controller.status()).install.state, 'ready');
});
