import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync, statSync, utimesSync, symlinkSync } from 'node:fs';
import { fixture, preview } from './fixtures.mjs';
import { dayWindow } from '../src/time.mjs';
import { Store } from '../src/store.mjs';
import { Controller } from '../src/controller.mjs';
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

async function setup(t) {
  const f = fixture(t); await f.bind(); f.store.set('learningAccount', '123');
  const l = f.controller.learning, binding = f.store.get('binding');
  const entry = (n, account = '123', patch = {}) => {
    const value = { id: 'expr-' + digest([n, account]).slice(0, 40), accountUid: account, expression: '学习表达' + n,
      meaning: '公开材料中的意思', context: '讨论证据', avoid: '', example: '示例', reason: '实际观察', sourceCount: 0,
      sources: [], uses: 0, version: 1, state: n % 2 ? 'active' : 'archived', ...patch };
    l.saveEntry(value); return value;
  };
  const review = (n, account = '123', patch = {}) => {
    const window = dayWindow(Date.parse('2026-09-01T12:00:00Z') + n * 86400000, 'Asia/Singapore');
    const r = { id: 'learn-' + digest([account, binding.sessionId, window.start, window.end]).slice(0, 40), accountUid: account, ...window,
      state: 'completed', stats: { observations: 1, videos: 1, events: 1 }, comparison: '与旧习惯比较后保留。', report: '公开学习汇报。', direction: '',
      iterationBefore: { version: n, traits: [] }, iterationAfter: { version: n + 1, traits: [] },
      sources: [{ id: 'source-' + n, bvid: 'BV1xx411c7mD', title: '公开视频', summary: '公开摘要' }], ...patch };
    l.saveReview(r); return r;
  };
  return { ...f, l, binding, entry, review };
}

test('learning archive searches literal text and normalized expressions, filters states and never exposes another account', async t => {
  const f = await setup(t); for (let i = 0; i < 24; i++) f.entry(i);
  f.entry(99, '999', { expression: 'PRIVATE_OTHER_ACCOUNT' });
  const special = f.entry(25, '123', { expression: 'ＡＳＭＲ_%', state: 'candidate' });
  const all = await f.controller.status(); assert.equal(all.learning.total, 25); assert.equal(all.learning.entries.length, 10);
  const filtered = await f.controller.status({ learningView: { q: 'asmr_%', state: 'candidate' } });
  assert.equal(filtered.learning.total, 1); assert.equal(filtered.learning.entries[0].id, special.id);
  assert.equal(filtered.learning.totalAll, 25); assert.equal(filtered.learning.counts.archived, 12);
  const empty = await f.controller.status({ learningView: { q: "' OR 1=1 --" } }); assert.equal(empty.learning.total, 0);
  assert.ok(!JSON.stringify(all.learning).includes('PRIVATE_OTHER_ACCOUNT'));
  assert.equal(f.counters.prompt, 0); assert.equal(f.counters.read, 0);
});

test('older reviews and all change events remain reachable with bounded stable pages, date and state filters', async t => {
  const f = await setup(t); for (let i = 0; i < 26; i++) f.review(i, '123', { state: i % 2 ? 'failed' : 'completed' }); f.review(99, '999');
  const e = f.entry(1); for (let i = 0; i < 61; i++) f.l.event('123', e.id, e, { ...e, version: i + 2 }, '变更' + i, 'user', 'reduce');
  f.l.event('999', e.id, e, e, 'PRIVATE_EVENT', 'user', 'stop');
  const ids = new Set(), events = new Set();
  for (let offset = 0; offset < 26; offset += 5) {
    const s = f.l.status(0, { reviewOffset: offset }); assert.ok(s.reviews.length <= 5); assert.equal(s.reviewPage.total, 26);
    for (const r of s.reviews) ids.add(r.id);
  }
  for (let offset = 0; offset < 61; offset += 10) for (const e of f.l.status(0, { eventOffset: offset }).events) events.add(e.id);
  assert.equal(ids.size, 26); assert.equal(events.size, 61);
  const s = f.l.status(0, { reviewFrom: '2026-09-10', reviewTo: '2026-09-15', reviewState: 'completed' });
  assert.equal(s.reviewPage.total, 3); assert.ok(s.reviews.every(r => r.day >= '2026-09-10' && r.day <= '2026-09-15'));
  assert.equal(f.l.status(0, { reviewOffset: 1000 }).reviewPage.offset, 25);
  assert.equal(f.counters.prompt, 0);
});

test('expression dossiers page every stored source and only that expression changes; stale account view resets safely', async t => {
  const f = await setup(t), e = f.entry(1), other = f.entry(2), foreign = f.entry(3, '999');
  for (let i = 0; i < 25; i++) {
    const bvid = 'BV' + String(i).padStart(10, '0');
    f.store.db.prepare('INSERT INTO learning_evidence VALUES(?,?,?)').run(e.id, bvid, JSON.stringify({ bvid, quote: '来源原文' + i, url: 'https://www.bilibili.com/video/' + bvid }));
  }
  f.l.event('123', e.id, e, { ...e, state: 'reduced' }, '本表达', 'user', 'reduce');
  f.l.event('123', other.id, other, other, '其他表达', 'user', 'stop');
  const s = f.l.status(0, { entity: e.id, sourceOffset: 20 });
  assert.equal(s.focus.sourceTotal, 25); assert.equal(s.focus.sources.length, 5); assert.equal(s.events.length, 1); assert.equal(s.events[0].reason, '本表达');
  const reset = f.l.status(100, { account: '999', q: 'PRIVATE_OTHER_ACCOUNT', entity: foreign.id });
  assert.equal(reset.view.account, '123'); assert.equal(reset.view.q, ''); assert.equal(reset.offset, 0); assert.equal(reset.focus, null);
  assert.throws(() => f.l.status(0, { entity: foreign.id }), { code: 'LEARNING_ENTRY' });
});

test('archive rejects malformed dates, unknown options and unsafe pages without any state mutation', async t => {
  const f = await setup(t), before = f.store.db.prepare('SELECT COUNT(*) n FROM learning_events').get().n;
  for (const view of [{ reviewFrom: '2026-02-30' }, { reviewFrom: '2026-10-24', reviewTo: '2026-10-01' }, { eventOffset: -1 },
    { sourceOffset: true }, { q: '\n' }, { toString: 'bad' }, { state: 'made_up' }]) assert.throws(() => f.l.status(0, view));
  assert.equal(f.store.db.prepare('SELECT COUNT(*) n FROM learning_events').get().n, before); assert.equal(f.counters.prompt, 0);
});

test('review export recovers legacy scope, is idempotent, stays in the original workspace and never repeats a model task', async t => {
  const f = await setup(t), r = f.review(1, '123', { report: '正文含```与![外部图](https://example.invalid/test.png)\n<script>外部材料</script>' });
  const before = JSON.stringify(f.store.db.prepare('SELECT data FROM learning_reviews').all()), persona = f.store.config().persona;
  const first = await f.controller.dispatch({ action: 'learning_export', reviewId: r.id }), file = join(f.workspacePath, first.path);
  assert.ok(existsSync(file)); const text = readFileSync(file, 'utf8'); assert.match(text, /与旧习惯比较后保留/); assert.match(text, /唯一对话/);
  assert.match(text, /````text/); assert.ok(first.path.startsWith('.bilibili-harness'));
  const sentinel = new Date('2020-01-01T00:00:00Z'); utimesSync(file, sentinel, sentinel);
  await f.controller.dispatch({ action: 'learning_export', reviewId: r.id }); assert.equal(statSync(file).mtimeMs, sentinel.getTime());
  assert.equal(JSON.stringify(f.store.db.prepare('SELECT data FROM learning_reviews').all()), before);
  assert.equal(f.store.config().persona, persona); assert.equal(f.counters.create, 1); assert.equal(f.counters.prompt, 0); assert.equal(f.counters.read, 0);
  const foreign = f.review(2, '999'); await assert.rejects(f.controller.dispatch({ action: 'learning_export', reviewId: foreign.id }));
  f.store.set('binding', { ...f.binding, sessionId: 'different-session' }); await assert.rejects(f.controller.dispatch({ action: 'learning_export', reviewId: r.id }));
});

test('automatic local archives cannot turn a completed daily review into failure, and manual retry uses the same saved result', async t => {
  let clock = Date.parse('2026-10-21T04:00:00Z');
  const f = fixture(t, { now: () => clock, output: (_prompt, id) => JSON.stringify(id.startsWith('learn-') ? {
    runId: id, integrated_persona: { text: '', reason: '暂无足够材料形成人设。', source_ids: [] }, comparison: '比较后保留当前习惯。', decisions: [], additions: [], expression_decisions: [], report: '', direction: '',
  } : preview(id)) });
  await f.bind(); f.controller.configure({ learningEnabled: true, timeZone: 'Asia/Singapore' });
  await f.controller.start({ requestId: 'archive-auto-source', bvid: 'BV1xx411c7mD' }); await f.controller.idle();
  const blocked = join(f.workspacePath, '.bilibili-harness', 'learning-reviews'); writeFileSync(blocked, 'temporary collision');
  clock += 86400000; const { id } = await f.controller.learning.review(); await f.controller.idle();
  assert.equal(f.store.run(id).state, 'completed'); assert.match(f.controller.learning.status().archiveNotice, /部分工作区档案/);
  const calls = f.counters.prompt; unlinkSync(blocked);
  const result = await f.controller.dispatch({ action: 'learning_export', reviewId: id }); assert.ok(existsSync(join(f.workspacePath, result.path)));
  assert.equal(f.counters.prompt, calls); assert.equal(f.controller.learning.status().archiveNotice, '');
});

test('review export rejects linked directories and preserves files outside the managed archive', async t => {
  const f = await setup(t), r = f.review(1), parent = join(f.workspacePath, '.bilibili-harness'), outside = join(f.root, 'outside');
  mkdirSync(parent); mkdirSync(outside); const sentinel = join(outside, 'sentinel.md'); writeFileSync(sentinel, 'keep');
  symlinkSync(outside, join(parent, 'learning-reviews'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(f.controller.dispatch({ action: 'learning_export', reviewId: r.id }));
  assert.equal(readFileSync(sentinel, 'utf8'), 'keep'); assert.equal(f.counters.prompt, 0);
});

test('archive querying and individual review export survive database reopen without touching publish ledgers', async t => {
  const f = await setup(t); f.entry(1); const r = f.review(15);
  const s = new Store(join(f.root, 'state.sqlite'));
  const c = new Controller({ store: s, host: f.host, reader: () => { throw new Error('must stay local'); } });
  try {
    assert.equal(c.learning.status().reviewPage.total, 1); await c.dispatch({ action: 'learning_export', reviewId: r.id });
    assert.equal(s.db.prepare('SELECT COUNT(*) n FROM weekly_attempts').get().n, 0);
    assert.equal(s.db.prepare('SELECT COUNT(*) n FROM learning_review_calls').get().n, 0);
  } finally { c.close(); s.close(); }
});
