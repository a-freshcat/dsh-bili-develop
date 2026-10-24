import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, preview, BV } from './fixtures.mjs';
import { Store } from '../src/store.mjs';
import { Controller } from '../src/controller.mjs';
import { makeHandler } from '../index.js';
import { join } from 'node:path';

test('privacy rejects direct PII, protected terms, encoded-width identifiers, unsafe links and local paths without exposing the match', async t => {
  const f = fixture(t); await f.bind(); f.controller.configure({ privacyBlockedTerms: ['合成的私密地址'], ownerAccountEnabled: true, ownerAccountUid: '987654321123' });
  for (const text of ['邮箱test@example.invalid', '电话' + '138' + '0'.repeat(8), 'C:\\Users\\synthetic\\private.txt', 'SESSDATA=synthetic-secret-value',
    '合成的私密地址', '９８７６５４３２１１２３', 'https://example.invalid/exfil', 'https://www.bilibili.com/video/' + BV + '/?private=value']) {
    assert.throws(() => f.controller.privacy.check(text), error => /^PRIVACY_/.test(error.code) && !error.message.includes(text));
  }
  assert.doesNotThrow(() => f.controller.privacy.check('依据这条视频讨论：https://www.bilibili.com/video/' + BV));
});

test('private fingerprints survive local clearing and database reopen; only same-recipient replies can reuse their material', async t => {
  const f = fixture(t); await f.bind(); const session = f.store.get('binding').sessionId;
  const secret = '这里是仅供隐私回归的私聊长句，不得进入别人的回复。';
  f.controller.privacy.remember('private-original-test', session, '123', '456', [secret]);
  assert.throws(() => f.controller.privacy.check(secret), { code: 'PRIVACY_PRIVATE_TEXT' });
  assert.doesNotThrow(() => f.controller.privacy.check(secret, { account: '123', recipient: '456' }));
  assert.throws(() => f.controller.privacy.check(secret, { account: '123', recipient: '999' }), { code: 'PRIVACY_PRIVATE_TEXT' });
  const s = new Store(join(f.root, 'state.sqlite')), c = new Controller({ store: s, host: f.host, reader: () => { throw new Error('must remain local'); } });
  try {
    assert.equal(c.privacy.context().sharedPrivateContext, true); assert.throws(() => c.privacy.check(secret), { code: 'PRIVACY_PRIVATE_TEXT' });
    const raw = JSON.stringify(s.db.prepare('SELECT * FROM privacy_digests').all()); assert.ok(!raw.includes(secret));
  } finally { c.close(); s.close(); }
});

test('manual privacy consent binds the current body and private context and expires without ever permitting automatic sending', async t => {
  const clock = { now: Date.now() }, f = fixture(t, { now: () => clock.now }); await f.bind(); const p = f.controller.privacy;
  p.remember('consent-private-source', p.session(), '123', '456', ['仅供测试的一段私聊材料']);
  const input = { privacyReviewed: true, privacyContext: p.context().contextHash };
  assert.throws(() => p.review('dm:test', 'private draft', { privacyReviewed: true }, true), { code: 'PRIVACY_REVIEW' });
  p.review('dm:test', 'private draft', input, true); assert.doesNotThrow(() => p.gate('dm:test', 'private draft', false, true));
  assert.throws(() => p.gate('dm:test', 'private draft', true, true), { code: 'PRIVACY_AUTO_BLOCKED' });
  assert.throws(() => p.gate('dm:test', 'edited draft', false, true), { code: 'PRIVACY_REVIEW' });
  assert.notEqual(f.store.db.prepare('SELECT revision FROM privacy_reviews').get().revision, 'private draft');
  clock.now += 300001; assert.throws(() => p.gate('dm:test', 'private draft', false, true), { code: 'PRIVACY_REVIEW' });
  clock.now -= 300001; p.remember('new-private-context', p.session(), '123', '789', ['另一段合成私聊材料']);
  assert.throws(() => p.gate('dm:test', 'private draft', false, true), { code: 'PRIVACY_REVIEW' });
});

test('a tainted conversation cannot send public comments before explicit privacy review or reserve any attempt', async t => {
  const f = fixture(t); await f.bind(); f.controller.configure({ commentMode: 'manual' });
  await f.controller.start({ requestId: 'privacy-public-comment', bvid: BV }); await f.controller.idle();
  const d = f.controller.comments.get('privacy-public-comment'), p = f.controller.privacy;
  p.remember('comment-private-context', p.session(), '123', '456', ['一段会使当前模型对话标记为私密的材料']);
  await assert.rejects(f.controller.comments.send(d.id, d.revision), { code: 'PRIVACY_REVIEW' });
  assert.equal(f.controller.comments.budget('123').attempts, 0);
  p.review('comment:' + d.id, d.revision, { privacyReviewed: true, privacyContext: p.context().contextHash }, true);
  assert.doesNotThrow(() => f.controller.comments.assertDraft(d, false));
  assert.throws(() => f.controller.comments.assertDraft(d, true), { code: 'PRIVACY_AUTO_BLOCKED' });
});

test('system and task prompts scrub common sensitive fields while public owner context never reveals the configured account', async t => {
  let prompt = ''; const f = fixture(t, { output(text, id) { prompt = text; return JSON.stringify(preview(id)); } }); await f.bind();
  f.controller.configure({ persona: '保持好奇。邮箱test@example.invalid，密码=synthetic-secret', ownerAccountEnabled: true, ownerAccountUid: '987654321123', ownerAccountName: '合成人名' });
  await f.controller.start({ requestId: 'privacy-prompt-scrub', bvid: BV }); await f.controller.idle();
  assert.doesNotMatch(prompt, /test@example\.invalid|synthetic-secret|987654321123|合成人名/);
  assert.match(prompt, /隐私信息已省略/); assert.match(prompt, /不向公开任务提供其UID/);
});

test('late privacy-invalid public results fail durably and release the active queue', async t => {
  const f = fixture(t, { noResult: true }); await f.bind(); await f.controller.start({ requestId: 'privacy-late-result', bvid: BV }); await f.controller.idle();
  const run = f.store.active(), value = { ...preview(run.id), summary: '邮箱test@example.invalid' }, events = f.sessions.get(run.sessionId).events;
  events.push({ seq: 1, type: 'user/message', data: { turn: 3, source: { rpcId: run.id } } },
    { seq: 2, type: 'assistant/message', data: { message: { content: [{ type: 'text', text: JSON.stringify(value) }] } } },
    { seq: 3, type: 'turn/end', data: { turn: 3, reason: { kind: 'completed' } } });
  await f.controller.reconcile(run.id); assert.equal(f.store.active(), null); assert.equal(f.store.run(run.id).error.code, 'PRIVACY_BLOCKED');
});

test('authenticated settings handler rejects cross-site fetch, JSON lookalikes, arrays, and UTF8 byte overflows before dispatch', async () => {
  let calls = 0; const handler = makeHandler({ dispatch() { calls++; return {}; } });
  const post = (body, headers = {}) => handler(new Request('http://localhost/api/bilibili-harness', { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body }));
  assert.equal((await post('{"action":"status"}', { 'sec-fetch-site': 'cross-site' })).status, 403);
  assert.equal((await post('{"action":"status"}', { 'content-type': 'application/jsonp' })).status, 415);
  assert.equal((await post('[]')).status, 400);
  assert.equal((await post(JSON.stringify({ action: 'status', text: '中'.repeat(25000) }))).status, 413);
  assert.equal(calls, 0); assert.equal((await post('{"action":"status"}')).status, 200); assert.equal(calls, 1);
});
