import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { fixture, BV, preview } from './fixtures.mjs';
import { Store, DEFAULT_CONFIG } from '../src/store.mjs';
import { Privacy } from '../src/privacy.mjs';
import { eligibility, rankedContacts } from '../src/contacts.mjs';
import { dayWindow } from '../src/time.mjs';
import { previewPrompt, parsePreview } from '../src/decision.mjs';

test('privacy metadata caches see local and external writes, new digest sizes, and preserve recipient/account boundaries', async t => {
  const f = fixture(t); await f.bind(); const p = f.controller.privacy, session = p.session();
  assert.equal(p.context().sharedPrivateContext, false); p.check('公开的普通文字');
  const local = '只用于测试的第一段私人文字，不允许转给其他联系人。';
  p.remember('cache-local-scope', session, '123', '456', [local]);
  assert.equal(p.context().privateRecipientCount, 1); assert.throws(() => p.check(local), { code: 'PRIVACY_PRIVATE_TEXT' });
  assert.doesNotThrow(() => p.check(local, { account: '123', recipient: '456' }));
  assert.throws(() => p.check(local, { account: '999', recipient: '456' }), { code: 'PRIVACY_PRIVATE_TEXT' });
  const other = new Store(join(f.root, 'state.sqlite'));
  try {
    const external = new Privacy({ ...f.controller, store: other });
    const short = '八个字的私密短句';
    external.remember('cache-external-scope', session, '123', '789', [short, local]);
    assert.equal(p.context().privateRecipientCount, 2);
    assert.throws(() => p.check(short), { code: 'PRIVACY_PRIVATE_TEXT' });
    assert.throws(() => p.check(local, { account: '123', recipient: '456' }), { code: 'PRIVACY_PRIVATE_TEXT' });
    assert.doesNotThrow(() => p.check(short, { account: '123', recipient: '789' }));
  } finally { other.close(); }
  const value = p.context(); value.sharedPrivateContext = false;
  assert.equal(p.context().sharedPrivateContext, true);
});

test('a rolled-back view can never cache an unsafe context or discard committed private fingerprints', async t => {
  const f = fixture(t); await f.bind(); const p = f.controller.privacy, session = p.session(), secret = '回滚测试中的持久私人内容必须保留防护。';
  p.remember('rollback-cache-scope', session, '123', '456', [secret]);
  const before = p.context().contextHash; p.check('公开的正常描述');
  assert.throws(() => f.store.transaction(() => {
    f.store.db.exec('DELETE FROM privacy_scopes; DELETE FROM privacy_digests;');
    assert.equal(p.context().sharedPrivateContext, false); p.check(secret);
    throw Error('synthetic rollback');
  }), /synthetic rollback/);
  assert.equal(p.context().contextHash, before); assert.equal(p.context().sharedPrivateContext, true);
  assert.throws(() => p.check(secret), { code: 'PRIVACY_PRIVATE_TEXT' });
  assert.throws(() => f.store.transaction(() => {
    p.remember('nested-savepoint-scope', session, '123', '999', ['这是应当被回滚的另一段合成消息。']);
    assert.equal(p.context().privateRecipientCount, 2); throw Error('nested rollback');
  }), /nested rollback/);
  assert.equal(p.context().privateRecipientCount, 1);
});

test('legacy backfill is atomic and once-only while new private scopes persist without redundant aliases', async t => {
  const f = fixture(t); await f.bind(); const p = f.controller.privacy, session = p.session();
  f.store.set('privacyBackfillV1', false);
  f.controller.social.contacts.saveMessage({ id: 'legacy-message', accountUid: '123', uid: '456', at: Date.now(), state: 'redacted', text: '', draft: '' });
  const migrated = new Privacy(f.controller); assert.equal(migrated.context().sharedPrivateContext, true);
  assert.equal(f.store.get('privacyBackfillV1'), true);
  migrated.remember('fresh-private-scope', session, '123', '789', ['重启后也保留这段新消息的保护。']);
  f.controller.social.contacts.saveMessage({ id: 'fresh-private-scope', accountUid: '123', uid: '789', at: Date.now(), state: 'draft', text: '合成消息' });
  const count = f.store.db.prepare('SELECT COUNT(*) n FROM privacy_scopes').get().n;
  const restarted = new Privacy(f.controller); assert.equal(restarted.context().privateRecipientCount, 2);
  assert.equal(f.store.db.prepare('SELECT COUNT(*) n FROM privacy_scopes').get().n, count);
});

test('indexed digest lookup is an exact match and uses the covering index', async t => {
  const f = fixture(t); await f.bind();
  const plan = f.store.db.prepare('EXPLAIN QUERY PLAN SELECT 1 FROM privacy_digests WHERE session_id=? AND size=? AND digest=? LIMIT 1').all('synthetic', 16, 'synthetic');
  assert.match(plan.map(r => r.detail).join(' '), /SEARCH.*privacy_digest_lookup/);
});

test('one-snapshot ranking gives the same owner, threshold, tie and top100 results as fresh eligibility', () => {
  const people = Array.from({ length: 140 }, (_, i) => ({ uid: String(i + 1), fan: i % 5 !== 0, blocked: i % 9 === 0, score: i % 3 ? 80 : 59 }));
  const config = { ...DEFAULT_CONFIG, ownerAccountEnabled: true, ownerAccountUid: '5' };
  const ranks = new Map(rankedContacts(people, config).map((p, i) => [p.uid, i]));
  for (const p of [...people, null]) assert.deepEqual(eligibility(p, people, config, ranks), eligibility(p, people, config));
});

test('binding health and recovery read the header without enumerating conversation events; result reads still include events', async t => {
  const f = fixture(t), binding = await f.bind(); let disposed = 0;
  f.ctx.sessionQuery.observeSession = async () => ({ header: { cwd: f.workspacePath }, get events() { throw Error('synthetic event enumeration'); }, [Symbol.dispose]() { disposed++; } });
  assert.equal((await f.host.health()).phase, 'active');
  assert.equal((await f.bind()).sessionId, binding.sessionId);
  await assert.rejects(f.host.observe(binding.sessionId), /synthetic event enumeration/);
  assert.ok(disposed >= 3); assert.equal(f.counters.create, 1);
});

test('day-window memoization preserves DST, exact midnight, backwards time, timezone changes and independent mutable copies', () => {
  const at = Date.parse('2026-11-01T12:00:00Z'), zone = 'America/New_York', w = dayWindow(at, zone);
  assert.equal(w.start, Date.parse('2026-11-01T04:00:00Z')); assert.equal(w.end, Date.parse('2026-11-02T05:00:00Z'));
  assert.equal(w.end - w.start, 25 * 3600000);
  w.start = -1; assert.notEqual(dayWindow(at, zone).start, -1);
  assert.equal(dayWindow(Date.parse('2026-11-02T05:00:00Z'), zone).day, '2026-11-02');
  assert.equal(dayWindow(at, zone).day, '2026-11-01');
  assert.equal(dayWindow(at, 'Asia/Singapore').end - dayWindow(at, 'Asia/Singapore').start, 86400000);
});

test('compact evidence keeps every subtitle and timestamp, requests one concise JSON, and accepts old and new result envelopes', () => {
  const segments = Array.from({ length: 300 }, (_, i) => ({ from: i * 1.5, to: i * 1.5 + 1, text: '公开字幕原文' + i }));
  const evidence = { bvid: BV, title: '合成材料', source: 'subtitle', coverage: 'complete', segments, text: segments.map(s => s.text).join('\n') };
  const prompt = previewPrompt({ id: 'compact-prompt-test' }, evidence, DEFAULT_CONFIG);
  const material = JSON.parse([...prompt.matchAll(/```json\n([\s\S]*?)\n```/g)].at(-1)[1]).evidence;
  assert.deepEqual(material.segmentFields, ['from', 'to', 'text']); assert.deepEqual(material.segments, segments.map(s => [s.from, s.to, s.text]));
  assert.match(prompt, /单行紧凑JSON/); assert.doesNotMatch(prompt, /先用简短中文给出评价/);
  const result = { ...preview('compact-prompt-test'), should_comment: false, comment: '', evidence_quote: '' }, raw = JSON.stringify(result);
  assert.deepEqual(parsePreview(raw, { id: result.runId }, evidence, DEFAULT_CONFIG), parsePreview('```json\n' + raw + '\n```', { id: result.runId }, evidence, DEFAULT_CONFIG));
});
