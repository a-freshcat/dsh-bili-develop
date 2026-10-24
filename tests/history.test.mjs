import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fixture, BV } from './fixtures.mjs';
import { History } from '../src/history.mjs';

async function setup(t) {
  const clock = { value: Date.parse('2026-10-24T04:00:00Z') };
  const f = fixture(t, { now: () => clock.value }); await f.bind();
  f.controller.configure({ dailyAnalysisLimit: 500, timeZone: 'Asia/Singapore' });
  function add(id, options = {}) {
    const run = f.store.start({ id, kind: options.kind || 'video', bvid: BV, accountUid: '123', sessionId: f.store.get('binding').sessionId, now: options.now || clock.value }).run;
    f.store.update(id, { state: options.state || 'preview', evidence: { ...f.evidence, title: options.title || id, source: options.source || 'subtitle' },
      preview: { summary: options.summary || '公开摘要', evaluation: '简短评价', should_comment: false }, ...options.patch });
    return f.store.run(run.id);
  }
  return { ...f, clock, add };
}

test('history filters match literal title/BV/summary, kind, source and state without exposing private tasks', async t => {
  const f = await setup(t);
  f.add('history-alpha', { title: 'ASMR 与 100% 测试', source: 'comments' });
  f.add('history-beta', { state: 'skipped', summary: '别的摘要' });
  f.add('history-private', { kind: 'dm', title: 'ASMR私人消息' });
  f.add('history-weekly', { kind: 'weekly', title: 'ASMR周任务' });
  assert.equal((await f.controller.status({ filters: { q: 'asmr' } })).total, 1);
  assert.equal(f.store.count({ q: '%' }), 1, 'search wildcard is literal');
  assert.equal(f.store.count({ q: "' OR 1=1 --" }), 0);
  assert.equal(f.store.count({ q: BV, source: 'comments', state: 'preview', kind: 'video' }), 1);
  assert.equal(f.store.count(), 2);
  await assert.rejects(f.controller.dispatch({ action: 'delete_record', requestId: 'history-weekly' }), /已结束的浏览/);
});

test('date filters use configured local calendar days including a 23-hour DST day', async t => {
  const f = await setup(t); f.controller.configure({ timeZone: 'America/New_York' });
  f.add('history-before-dst', { now: Date.parse('2026-03-08T04:59:59Z') });
  f.add('history-inside-dst1', { now: Date.parse('2026-03-08T05:00:00Z') });
  f.add('history-inside-dst2', { now: Date.parse('2026-03-09T03:59:59Z') });
  f.add('history-after-dst', { now: Date.parse('2026-03-09T04:00:00Z') });
  assert.equal(f.store.count({ from: '2026-03-08', to: '2026-03-08' }), 2);
  for (const filter of [{ from: '2026-02-30' }, { from: '2026-04-02', to: '2026-03-01' }, { source: 'dm' }, { q: [] }])
    await assert.rejects(f.controller.status({ filters: filter }));
});

test('batch preview does not delete; confirmation deletes the exact reviewed terminal snapshot and preserves usage and seen history', async t => {
  const f = await setup(t); const binding = f.store.get('binding');
  for (let i = 0; i < 104; i++) f.add('history-batch-' + String(i).padStart(3, '0'), { title: '待清理材料' + i });
  f.add('history-review-needed', { state: 'needs_review', title: '待清理材料待核对' });
  f.store.markSeen('123', BV);
  const used = f.store.budget(f.store.config(), f.clock.value).analyses;
  const p = await f.controller.dispatch({ action: 'history_preview_delete', filters: { q: '待清理材料' } });
  assert.equal(p.count, 100); assert.equal(p.records.length, 100); assert.equal(p.more, true); assert.equal(f.store.count(), 105);
  await assert.rejects(f.controller.dispatch({ action: 'history_confirm_delete', token: p.token }), /预览已过期/);
  f.add('history-added-later', { title: '待清理材料新记录' });
  await f.controller.dispatch({ action: 'history_confirm_delete', token: p.token, confirmed: true });
  assert.equal(f.store.count(), 6); assert.ok(f.store.run('history-added-later')); assert.ok(f.store.run('history-review-needed'));
  assert.equal(f.store.budget(f.store.config(), f.clock.value).analyses, used + 1); assert.equal(f.store.seen('123', BV), true);
  assert.equal(f.store.get('binding').sessionId, binding.sessionId); assert.equal(f.counters.prompt, 0); assert.equal(f.counters.read, 0);
});

test('expired previews, record edits and binding changes invalidate batch confirmation without partial deletions', async t => {
  for (const change of [f => { f.clock.value += 300001; }, f => f.store.update('history-stale', { waitReason: 'changed' }),
    f => f.store.set('binding', { ...f.store.get('binding'), path: f.root })]) {
    const f = await setup(t); f.add('history-stale'); const p = f.controller.history.preview({}); change(f);
    await assert.rejects(f.controller.dispatch({ action: 'history_confirm_delete', token: p.token, confirmed: true }));
    assert.ok(f.store.run('history-stale'));
  }
});

test('file deletion failures retain durable cleanup jobs and can retry after the row is gone', async t => {
  const f = await setup(t); const run = f.add('history-note-retry'); f.controller.finish(run.id, {});
  const note = join(f.workspacePath, f.store.run(run.id).notePath);
  f.controller.history.deleteFile = () => { throw new Error('locked'); };
  const p = f.controller.history.preview({});
  const result = f.controller.history.confirm({ token: p.token, confirmed: true });
  assert.equal(result.pendingNotes, 1); assert.equal(f.store.run(run.id), null); assert.equal(existsSync(note), true);
  f.controller.history = new History(f.controller); f.controller.history.retryNotes();
  assert.equal(f.store.get('pendingHistoryNotes').length, 0); assert.equal(existsSync(note), false);
});

test('all note paths are checked before deleting any reviewed rows or unrelated workspace files', async t => {
  const f = await setup(t); const first = f.add('history-safe-note'); const bad = f.add('history-folder-note');
  f.controller.finish(first.id, {});
  const badPath = join(f.workspacePath, '.bilibili-harness', 'notes', bad.id + '.md'); mkdirSync(badPath);
  const document = join(f.workspacePath, 'my-document.md'); writeFileSync(document, 'untouched');
  const p = f.controller.history.preview({});
  assert.throws(() => f.controller.history.confirm({ token: p.token, confirmed: true }), /链接或目录/);
  assert.ok(f.store.run(first.id)); assert.ok(f.store.run(bad.id)); assert.equal(readFileSync(document, 'utf8'), 'untouched');
});

test('filtered cover fill only reads video metadata for the visible filtered page', async t => {
  const f = await setup(t); f.add('history-cover-a', { title: '选中的视频' }); f.add('history-cover-b', { title: '别的视频' });
  const calls = []; f.controller.reader = () => ({ call: async (_method, params) => { calls.push(params.bvid); return { bvid: params.bvid, cover: 'https://i0.hdslb.com/bfs/archive/fixture.jpg' }; } });
  f.controller.refreshCovers(0, { q: '选中的视频' }); await f.controller.coverJob;
  assert.deepEqual(calls, [BV]); assert.equal(f.counters.prompt, 0);
  assert.ok(f.store.run('history-cover-a').evidence.cover); assert.equal(f.store.run('history-cover-b').evidence.cover, undefined);
});

test('diagnostics is local and omits all account, model text, persona and path data', async t => {
  const f = await setup(t); f.add('history-diagnostic', { title: 'PRIVATE_VIDEO_TITLE', summary: 'PRIVATE_SUMMARY' });
  f.controller.configure({ persona: 'PRIVATE_PERSONA', ownerAccountName: 'PRIVATE_OWNER', pythonPath: 'PRIVATE_PATH' });
  f.store.set('socialAccount', '123456789987654321');
  const report = await f.controller.dispatch({ action: 'diagnostics' }), json = JSON.stringify(report);
  for (const forbidden of ['PRIVATE_', f.root, '123456789987654321', BV]) assert.ok(!json.includes(forbidden));
  assert.equal(report.records.public, 1); assert.equal(report.pluginVersion, JSON.parse(readFileSync('package.json', 'utf8')).version); assert.equal(report.modes.weeklyAlwaysReviewed, true);
  assert.equal(f.counters.prompt, 0); assert.equal(f.counters.read, 0);
});
