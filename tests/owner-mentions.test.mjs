import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, preview, BV } from './fixtures.mjs';
import { OwnerMentions } from '../src/owner-mentions.mjs';

async function setup(t, options = {}) {
  let now = Date.parse('2026-10-24T12:00:00+08:00'); const calls = [], prompts = [];
  const evidence = { bvid: BV, title: '测试字幕材料', source: 'subtitle', coverage: 'complete', language: '中文',
    text: '测试字幕原文内容足够验证。', segments: [{ from: 0, to: 4, text: '测试字幕原文内容足够验证。' }],
    totalSegments: 1, accountUid: '123', readAt: new Date(now).toISOString() };
  const discussion = { comments: [], count: 0, limit: 20, maxChars: 6000, orders: ['thread', 'hot', 'recent'], failedOrders: [] };
  const item = (id, level = 'top') => ({ id, root: level === 'top' ? id : '101', uid: '789', text: '@大肥鱼 你怎么看这个？', level,
    mentionedUids: ['123'], bvid: BV, notificationId: '9' + id, at: now });
  const f = fixture(t, { now: () => now, output: (text, id) => {
    prompts.push(text); const target = JSON.parse(text.split('\n').at(-1)).target;
    return JSON.stringify({ ...preview(id), comment: '这个问题值得一起聊聊。' + target.id, evidence_quote: target.text });
  }, call: async (method, p) => {
    calls.push({ method, p });
    // A custom call handler for one method must not starve the reader of the
    // newly required video/discussion reads, so fall through before them.
    if (options.call) { const value = await options.call(method, p); if (value !== undefined) return value; }
    if (method === 'owner_mentions') return { accountUid: '123', matches: options.items?.(item) || [item('101'), item('102'), item('201', 'sub')] };
    if (method === 'read_video') return { ...evidence, bvid: p.bvid, accountUid: '123' };
    if (method === 'mentioned_video_context') return { accountUid: '123', bvid: p.bvid, target: p.target, discussion };
    if (method === 'comment_reply_probe' || method === 'comment_reply_publish') return { accountUid: '123', bvid: p.bvid, oid: '987', target: p.target, mentions: [], confirmed: true, receipt: '555' };
    throw new Error(method);
  } });
  await f.bind(); f.controller.social.setAccount('123');
  f.controller.configure({ ownerAccountEnabled: true, ownerAccountUid: '789', ownerCommentReplyEnabled: true, interactionKeywords: [], ...options.config });
  return { ...f, item, calls, prompts, advance(ms = 120000) { now += ms; },
    async scan() { f.controller.ownerMentions.scan(); await f.controller.ownerMentions.job; },
    // Owner-mention replies are video-sourced reads, so they are not kind='interaction'.
    replies() { return f.store.list(100).filter(r => r.interactionTrigger === 'owner_mention'); } };
}

test('owner at notifications from unbrowsed videos create only bound reply drafts, with per-check type limits and no video analysis', async t => {
  const f = await setup(t); await f.scan();
  assert.equal(f.replies().length, 2); assert.equal(f.counters.prompt, 2); assert.equal(f.counters.create, 1);
  assert.ok(f.replies().every(r => r.interactionOrigin === 'notification' && r.interactionTrigger === 'owner_mention' && r.state === 'preview'));
  // These reads are video-sourced, but they must not consume the analysis budget.
  assert.equal(f.store.db.prepare("SELECT COUNT(*) n FROM usage_ledger WHERE kind='analysis'").get().n, 0);
  assert.equal(f.store.audioBudget(f.store.config()).requests, 0);
  // The notification read, plus exactly the video and discussion reads it needs.
  assert.ok(f.calls.every(c => ['owner_mentions', 'read_video', 'mentioned_video_context'].includes(c.method)));
  assert.equal(f.calls.filter(c => c.method === 'read_video').length, 2);
  assert.equal(f.controller.metadataBusy, false);
  assert.equal(f.controller.interactions.budget('123').evaluations, 2);
});

test('restart, repeat check and deletion retain per-comment evaluation dedup', async t => {
  const f = await setup(t); await f.scan();
  const first = f.replies().find(r => r.interactionTarget.id === '101'); await f.controller.deleteRecord(first.id);
  assert.equal(f.store.db.prepare('SELECT 1 FROM interaction_scans WHERE source_id=?').get(first.sourceRunId), undefined);
  f.controller.ownerMentions = new OwnerMentions(f.controller); await f.scan(); await f.scan();
  assert.equal(f.counters.prompt, 3, 'only the next previously unhandled top comment is processed');
  assert.ok(f.calls.filter(c => c.method === 'owner_mentions').at(-1).p.handled_ids.includes('101'));
});

test('manual mode sends to original comment and owner is not subject to fan score or top100 limits', async t => {
  const f = await setup(t, { config: { commentMode: 'manual' }, items: item => [item('101')] });
  f.controller.social.contacts.put('123', '789', { score: 0, fan: false });
  await f.scan(); const d = f.replies()[0].commentPublication;
  await f.controller.comments.send(d.id, d.revision);
  assert.equal(f.calls.filter(c => c.method === 'comment_reply_publish').length, 1);
  assert.equal(f.calls.find(c => c.method === 'comment_reply_publish').p.owner_mention_uid, '789');
});

test('daily zero, per-type zero, pause, disabled switch and activity hours stop automatic checks', async t => {
  for (const config of [{ dailyInteractionEvaluationLimit: 0 }, { interactionTopLimit: 0, interactionSubLimit: 0 },
    { ownerCommentReplyEnabled: false }, { activityStart: '14:00', activityEnd: '15:00' }]) {
    const f = await setup(t, { config }); f.controller.ownerMentions.tick(); assert.equal(f.calls.length, 0);
  }
  const f = await setup(t); f.controller.scheduler.pause(); f.controller.ownerMentions.tick(); assert.equal(f.calls.length, 0);
  assert.throws(() => f.controller.ownerMentions.scan(), { code: 'COMMENTS_DISABLED' });
});

test('poll interval and background busy gate avoid repeated platform or model calls', async t => {
  const f = await setup(t, { items: () => [] }); const m = f.controller.ownerMentions;
  m.tick(); await m.job; m.tick(); assert.equal(f.calls.length, 1);
  f.advance(); f.controller.metadataBusy = true; m.tick(); assert.equal(f.calls.length, 1);
  f.controller.metadataBusy = false; m.tick(); await m.job; assert.equal(f.calls.length, 2);
});

test('API edits are blocked while checking; external identity changes invalidate results and queued draft', async t => {
  let release; const f = await setup(t, { config: { commentMode: 'manual' }, call: (method) => method === 'owner_mentions' ? new Promise(resolve => { release = resolve; }) : undefined });
  f.controller.ownerMentions.scan(); while (!release) await new Promise(r => setImmediate(r));
  assert.throws(() => f.controller.configure({ ownerAccountUid: '999' }), { code: 'RUN_BUSY' });
  const before = f.store.config(), after = { ...before, ownerAccountUid: '999' };
  f.store.set('config', after); f.controller.interactions.configured(before, after);
  release({ accountUid: '123', matches: [f.item('101')] });
  await f.controller.ownerMentions.job; assert.equal(f.replies().length, 0);
  const g = await setup(t, { config: { commentMode: 'manual' }, items: item => [item('101')] }); await g.scan();
  const d = g.replies()[0].commentPublication; g.controller.configure({ ownerAccountUid: '999' });
  await assert.rejects(g.controller.comments.send(d.id, d.revision), { code: 'INTERACTION_DISABLED' });
});

test('owner mention automatic replies retain shared-private-context privacy gate', async t => {
  const f = await setup(t, { config: { commentMode: 'auto' }, items: item => [item('101')] }); await f.scan();
  const d = f.replies()[0].commentPublication;
  f.controller.privacy.remember('synthetic-private', f.store.get('binding').sessionId, '123', '789', ['仅用于隐私回归的私信原文']);
  await assert.rejects(f.controller.comments.send(d.id, d.revision, true), { code: 'PRIVACY_AUTO_BLOCKED' });
  // Only the notification read plus the video/discussion reads it needs; no publishing call.
  assert.ok(f.calls.every(c => ['owner_mentions', 'read_video', 'mentioned_video_context'].includes(c.method)));
});

test('wrong account, old notifications and wrong author fail closed without model or send', async t => {
  for (const changes of [{ uid: '999' }, { at: 1 }, { mentionedUids: ['999'] }]) {
    const f = await setup(t, { items: item => [{ ...item('101'), ...changes }] }); await f.scan();
    assert.equal(f.counters.prompt, 0); assert.ok(f.controller.ownerMentions.error);
  }
  const f = await setup(t, { call: method => method === 'owner_mentions' ? { accountUid: '999', matches: [] } : undefined });
  await f.scan(); assert.equal(f.controller.ownerMentions.error.code, 'ACCOUNT_CHANGED'); assert.equal(f.counters.prompt, 0);
});
