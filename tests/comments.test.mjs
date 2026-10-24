import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fixture, BV, preview } from './fixtures.mjs';
import { Comments } from '../src/comments.mjs';
import { Store } from '../src/store.mjs';
import { configOf, parsePreview } from '../src/decision.mjs';

const target = (uid = '456', name = '测试对象') => ({ uid, name, enabled: true, allowComment: true, allowDynamic: false });
async function setup(t, config = {}, hooks = {}) {
  let now = Date.parse('2026-10-23T04:00:00Z'), serial = 0;
  const calls = [];
  const f = fixture(t, { now: () => now,
    output: (_text, id) => JSON.stringify({ ...preview(id), comment: hooks.sameBody ? '内容讲得很清楚，希望继续更新。' : '内容讲得很清楚，希望继续更新。' + id }),
    call: async (method, p) => {
      calls.push({ method, p });
      if (hooks.call) { const result = await hooks.call(method, p); if (result !== undefined) return result; }
      if (method === 'read_video') return { ...f.evidence, bvid: p.bvid };
      if (method === 'user_info') return { uid: p.uid, name: '解析的昵称', face: '' };
      const found = { accountUid: p.expected_account, bvid: p.bvid, oid: '987', mentions: p.mentions };
      if (method === 'comment_probe') return found;
      if (method === 'comment_publish') return { ...found, confirmed: true, receipt: '555', mentionState: 'rendered' };
      if (method === 'comment_verify') return { ...found, confirmed: !!hooks.found, receipt: hooks.found ? '555' : '' };
      throw new Error('Unexpected method ' + method);
    } });
  await f.bind();
  if (config.commentMode === 'auto') f.controller.comments.pause();
  f.controller.configure({ commentMode: 'manual', commentMinIntervalSeconds: 60, ...config });
  const draft = async (bvid = 'BV1xx411c7m' + String.fromCharCode(68 + serial)) => {
    const id = 'comment-test-' + ++serial;
    await f.controller.start({ requestId: id, bvid }); await f.controller.idle();
    assert.equal(f.store.run(id).state, 'preview');
    return f.controller.comments.get(id);
  };
  const send = d => f.controller.comments.send(d.id, d.revision);
  const posts = () => calls.filter(x => x.method === 'comment_publish');
  return { ...f, comments: f.controller.comments, calls, draft, send, posts,
    advance(ms = 60000) { now += ms; }, now: () => now };
}

test('preview mode blocks sending, while read-only checks consume no send allowance', async t => {
  const f = await setup(t, { commentMode: 'preview' }); const d = await f.draft();
  await assert.rejects(f.send(d), { code: 'COMMENTS_DISABLED' });
  f.comments.check(d.id); await f.comments.job;
  assert.equal(f.posts().length, 0); assert.equal(f.comments.budget('123').attempts, 0);
  assert.match(f.comments.notice, /未发送/); assert.equal(f.counters.prompt, 1);
});

test('manual publication uses final revision, persists a receipt/note and reuses the native conversation', async t => {
  const f = await setup(t, { commentMentionsEnabled: true, mentionTargets: [target()] });
  const d = await f.draft(); const updated = f.comments.stage(d.id, ['456']).publication;
  await assert.rejects(f.send(d), { code: 'COMMENT_REVISION' });
  f.comments.publish(updated.id, updated.revision); await f.comments.job;
  const saved = f.comments.get(d.id); assert.equal(saved.state, 'sent'); assert.equal(saved.receipt, '555');
  assert.match(f.posts()[0].p.text, /\n@测试对象 $/); assert.deepEqual(f.posts()[0].p.mentions, [{ uid: '456', name: '测试对象' }]);
  assert.equal(f.comments.budget('123').mentionAttempts, 1);
  const run = f.store.run(d.id);
  assert.match(readFileSync(join(f.workspacePath, run.notePath), 'utf8'), /评论平台记录（公开展示另行核对）/);
  assert.equal(saved.confirmationSource, 'platform_receipt');
  assert.equal(f.counters.create, 1); assert.equal(f.counters.prompt, 1);
  await assert.rejects(f.send(updated), { code: 'COMMENT_DRAFT' }); assert.equal(f.posts().length, 1);
});

test('uncertain sends retain quota and prevent retries across record deletion and reopening', async t => {
  const f = await setup(t, { dailyCommentLimit: 2 }, { call: (method) => {
    if (method === 'comment_publish') throw Object.assign(new Error('transport lost'), { code: 'COMMENT_UNKNOWN' });
  } });
  const d = await f.draft(); await f.send(d); assert.equal(f.comments.get(d.id).state, 'unknown');
  f.comments.verify(d.id); await f.comments.job; assert.equal(f.comments.get(d.id).state, 'unknown');
  await f.controller.deleteRecord(d.id); assert.equal(f.comments.budget('123').attempts, 1);
  assert.equal(f.comments.get(d.id).text, ''); assert.equal(f.comments.get(d.id).contentCleared, true);
  f.comments.verify(d.id); await f.comments.job; assert.equal(f.comments.error.code, 'COMMENT_VERIFY');
  const retry = await f.draft(BV); await assert.rejects(f.send(retry), { code: 'COMMENT_DUPLICATE' });
  const reopened = new Store(join(f.root, 'state.sqlite'));
  const restarted = new Comments({ ...f.controller, store: reopened });
  assert.equal(restarted.get(d.id).state, 'unknown'); assert.equal(restarted.budget('123').attempts, 1);
  reopened.close(); assert.equal(f.posts().length, 1);
});

test('restart changes an in-flight send to unknown; read-only verification never publishes again', async t => {
  const f = await setup(t, {}, { found: true }); const d = await f.draft();
  f.comments.reserve(d, false);
  const restarted = new Comments(f.controller); assert.equal(restarted.get(d.id).state, 'unknown');
  const run = f.store.run(d.id);
  assert.match(readFileSync(join(f.workspacePath, run.notePath), 'utf8'), /评论发送结果待核对/);
  restarted.verify(d.id); await restarted.job;
  assert.equal(restarted.get(d.id).state, 'sent'); assert.equal(f.posts().length, 0);
  assert.equal(restarted.get(d.id).confirmationSource, 'account_lookup');
  assert.match(restarted.notice, /公开列表可见性未确认/);
  assert.match(readFileSync(join(f.workspacePath, f.store.run(d.id).notePath), 'utf8'), /公开列表可见性未确认/);
  assert.equal(restarted.context('123')[0].publicVisibility, 'unchecked');
  assert.equal(f.comments.budget('123').attempts, 1);
});

test('daily zero, cooldown, per-round and unchanged day-text limits block additional POSTs', async t => {
  const f = await setup(t, { dailyCommentLimit: 0 }); const a = await f.draft();
  await assert.rejects(f.send(a), { code: 'COMMENT_LIMIT' });
  f.controller.configure({ dailyCommentLimit: 2 }); await f.send(a);
  const b = await f.draft(); await assert.rejects(f.send(b), { code: 'COMMENT_COOLDOWN' });
  f.advance(); f.comments.save({ ...f.comments.get(b.id), roundKey: a.roundKey }, false);
  await assert.rejects(f.send(b), { code: 'COMMENT_ROUND_LIMIT' });
  f.comments.save({ ...f.comments.get(b.id), roundKey: 'independent' }, false); await f.send(b);
  f.advance(); const c = await f.draft(); await assert.rejects(f.send(c), { code: 'COMMENT_LIMIT' });
  assert.equal(f.posts().length, 2);
  const g = await setup(t, {}, { sameBody: true }); const first = await g.draft(); await g.send(first);
  g.advance(); await assert.rejects(g.send(await g.draft()), { code: 'COMMENT_REPEAT' }); assert.equal(g.posts().length, 1);
});

test('own-account receipts and anonymous list samples remain separate across verification, notes and model context', async t => {
  let publicList = { state: 'not_in_sample', sampleCount: 3 };
  const f = await setup(t, {}, { call: (method, p) => {
    if (method === 'comment_publish') return { accountUid: p.expected_account, bvid: p.bvid, confirmed: false };
    if (method === 'comment_verify') return { accountUid: p.expected_account, bvid: p.bvid, confirmed: true, receipt: '555', publicList };
  } });
  const d = await f.draft(); await f.send(d);
  assert.equal(f.comments.get(d.id).state, 'unknown');
  for (const sample of [publicList, { state: 'found', sampleCount: 3 }, { state: 'unavailable' }, { state: 'found', sampleCount: 21 }]) {
    publicList = sample; f.comments.verify(d.id); await f.comments.job;
    const saved = f.comments.get(d.id), run = f.store.run(d.id);
    assert.equal(saved.state, 'sent', 'this means a matching platform record, not guaranteed public delivery');
    assert.equal(saved.receipt, '555');
    assert.equal(saved.publicList.state, sample.sampleCount === 21 ? 'unchecked' : sample.state);
    assert.deepEqual(run.commentPublication.publicList, saved.publicList);
    assert.equal(f.comments.context('123')[0].publicVisibility, saved.publicList.state);
    assert.match(readFileSync(join(f.workspacePath, run.notePath), 'utf8'), /不代表其他账号的公开列表可见/);
    await assert.rejects(f.send(saved), { code: 'COMMENT_DRAFT' });
    assert.equal(f.posts().length, 1);
    assert.equal(f.comments.budget('123').attempts, 1);
  }
});

test('per-round attempts remain counted across midnight even when daily usage resets', async t => {
  const f = await setup(t); const a = await f.draft(); await f.send(a);
  f.advance(86400000); const b = await f.draft(); f.comments.save({ ...b, roundKey: a.roundKey }, false);
  assert.equal(f.comments.budget('123').attempts, 0);
  await assert.rejects(f.send(b), { code: 'COMMENT_ROUND_LIMIT' });
});

test('mention quota and target cooldown do not silently strip mentions from the preview', async t => {
  const f = await setup(t, { commentMentionsEnabled: true, mentionTargets: [target()], dailyMentionLimit: 1 });
  const a = await f.draft(); const aa = f.comments.stage(a.id, ['456']).publication; await f.send(aa);
  f.advance(); const b = await f.draft(); const bb = f.comments.stage(b.id, ['456']).publication;
  await assert.rejects(f.send(bb), { code: 'MENTION_LIMIT' });
  f.controller.configure({ dailyMentionLimit: 5 }); await assert.rejects(f.send(bb), { code: 'MENTION_COOLDOWN' });
  assert.match(f.comments.get(b.id).text, /@测试对象/); assert.equal(f.posts().length, 1);
  f.advance(3600000); await f.send(bb); assert.equal(f.posts().length, 2);
});

test('removed, disabled or renamed targets and changed persona invalidate pending sends', async t => {
  const f = await setup(t, { commentMentionsEnabled: true, mentionTargets: [target()] }); const a = await f.draft();
  let d = f.comments.stage(a.id, ['456']).publication;
  f.controller.configure({ mentionTargets: [target('456', '新昵称')] });
  await assert.rejects(f.send(d), { code: 'MENTION_CHANGED' });
  d = f.comments.stage(a.id, ['456']).publication;
  f.controller.configure({ mentionTargets: [] }); await assert.rejects(f.send(d), { code: 'MENTION_TARGET' });
  f.controller.configure({ mentionTargets: [target()] }); d = f.comments.stage(a.id, []).publication;
  f.controller.configure({ persona: '修改后的基础人设。' }); await assert.rejects(f.send(d), { code: 'COMMENT_STALE' });
  assert.equal(f.posts().length, 0);
});

test('account mismatch and pause during an awaited preflight cause no POST and consume no quota', async t => {
  let release, mismatch = true;
  const f = await setup(t, {}, { call: (method, p) => {
    if (method === 'comment_probe') {
      if (mismatch) return { accountUid: '999', bvid: p.bvid, oid: '987', mentions: [] };
      return new Promise(resolve => { release = () => resolve({ accountUid: '123', bvid: p.bvid, oid: '987', mentions: [] }); });
    }
  } }); const d = await f.draft();
  await assert.rejects(f.send(d), { code: 'COMMENT_TARGET' }); mismatch = false;
  f.comments.publish(d.id, d.revision); await new Promise(resolve => setImmediate(resolve));
  assert.throws(() => f.controller.configure({ commentMode: 'preview' }), { code: 'RUN_BUSY' });
  f.comments.pause(); release(); await f.comments.job;
  assert.equal(f.posts().length, 0); assert.equal(f.comments.budget('123').attempts, 0);
});

test('enabling auto never sends old drafts; fresh drafts obey pause, deletion and persistent backoff', async t => {
  const f = await setup(t); const old = await f.draft();
  f.advance(); f.comments.pause(); f.controller.configure({ commentMode: 'auto' }); f.comments.resume();
  f.comments.tick(); await f.comments.job; assert.equal(f.posts().length, 0);
  const fresh = await f.draft();
  f.controller.scheduler.pause(); f.comments.tick(); await f.comments.job; assert.equal(f.posts().length, 0);
  f.controller.scheduler.resume(); f.comments.pause(); f.comments.tick(); assert.equal(f.posts().length, 0);
  await f.controller.deleteRecord(fresh.id); assert.equal(f.comments.get(fresh.id).state, 'cancelled');
  f.comments.resume(); f.comments.tick(); await f.comments.job; assert.equal(f.posts().length, 0);
  assert.equal(f.comments.get(old.id).state, 'draft');
  const next = await f.draft(); f.store.set('commentRetryAfter', f.now() + 60000);
  f.comments.tick(); await f.comments.job; assert.equal(f.posts().length, 0);
  f.advance(); f.comments.tick(); await f.comments.job; assert.equal(f.comments.get(next.id).state, 'sent');
});

test('an exhausted round does not starve a fresh auto round; errors before POST back off', async t => {
  let unavailable = false;
  const f = await setup(t, { commentMode: 'auto' }, { call: (method) => { if (unavailable && method === 'comment_probe') throw new Error('offline'); } });
  const a = await f.draft();
  f.comments.resume(); await f.send(a); f.comments.pause(); f.advance();
  const b = await f.draft(); f.comments.save({ ...b, roundKey: a.roundKey }, false);
  const c = await f.draft(); f.comments.resume(); f.comments.tick(); await f.comments.job;
  assert.equal(f.comments.get(b.id).state, 'draft'); assert.equal(f.comments.get(c.id).state, 'sent');
  f.comments.pause(); f.advance(); const d = await f.draft(); unavailable = true;
  f.comments.resume(); f.comments.tick(); await f.comments.job;
  assert.equal(f.store.get('commentRetryAfter'), f.now() + 60000); assert.equal(f.comments.get(d.id).state, 'draft');
});

test('structured mentions reject injected @, unlisted UIDs, duplicates and excess final length', async t => {
  const f = await setup(t, { commentMentionsEnabled: true, mentionTargets: [target(), target('789', '同名')], mentionsPerComment: 2 });
  const d = await f.draft(), run = f.store.run(d.id), c = f.store.config();
  for (const change of [{ comment: '@未授权' }, { mention_uids: ['999'] }, { mention_uids: ['456', '456'] }])
    assert.throws(() => parsePreview(JSON.stringify({ ...run.preview, ...change }), run, run.evidence, c), { code: 'MODEL_MENTION' });
  assert.throws(() => f.comments.stage(d.id, ['456', '456']), { code: 'COMMENT_MENTION' });
  f.controller.configure({ mentionTargets: [target(), target('789', '测试对象')] });
  assert.throws(() => f.comments.stage(d.id, ['456', '789']), { code: 'MENTION_NAME' });
  f.controller.configure({ commentMaxChars: run.preview.comment.length });
  assert.throws(() => f.comments.stage(d.id, ['456']), { code: 'COMMENT_LENGTH' });
  assert.throws(() => configOf({ mentionTargets: [target(), target()] }, c), { code: 'INVALID_CONFIG' });
});

test('public result context is account-scoped; profile resolution does not create model turns', async t => {
  const f = await setup(t); const a = await f.draft(); await f.send(a);
  assert.equal(f.comments.context('999').length, 0); assert.equal(f.comments.context('123')[0].state, 'sent');
  const before = f.counters.prompt; await f.controller.addMention('https://space.bilibili.com/456');
  assert.equal(f.store.config().mentionTargets[0].name, '解析的昵称'); assert.equal(f.counters.prompt, before);
  f.advance(); const b = await f.draft();
  assert.match(f.store.run(b.id).promptText, /555/); assert.equal(f.counters.create, 1);
});

test('closing before a queued publish starts leaves the draft intact and issues no POST', async t => {
  const f = await setup(t); const d = await f.draft(); f.comments.publish(d.id, d.revision); f.controller.close();
  await f.comments.job; assert.equal(f.posts().length, 0); assert.equal(f.comments.get(d.id).state, 'draft');
});

test('explicit platform rejection remains charged and cannot be retried', async t => {
  const f = await setup(t, {}, { call: method => {
    if (method === 'comment_publish') throw Object.assign(new Error('平台拒绝'), { code: 'COMMENT_REJECTED' });
  } }); const d = await f.draft(); await f.send(d);
  assert.equal(f.comments.get(d.id).state, 'failed'); assert.equal(f.comments.budget('123').attempts, 1);
  await assert.rejects(f.send(d), { code: 'COMMENT_DRAFT' }); assert.equal(f.posts().length, 1);
});

test('pending platform feedback and candidate receipt persist without success or resend, and deletion clears hint text', async t => {
  const f = await setup(t, {}, { found: true, call: (method, p) => {
    if (method === 'comment_publish') return { accountUid: p.expected_account, bvid: p.bvid, confirmed: false, receipt: '', receiptCandidate: '555',
      platformFeedback: { captured: true, toast: '评论已提交，审核通过后展示', needCaptcha: true, replyState: 17, invisible: true, extra: 'private-debug' } };
  } });
  const d = await f.draft(); await f.send(d); let saved = f.comments.get(d.id);
  assert.equal(saved.state, 'unknown'); assert.equal(saved.receipt, ''); assert.equal(saved.receiptCandidate, '555');
  assert.equal(saved.platformFeedback.toast, '评论已提交，审核通过后展示'); assert.equal(saved.platformFeedback.extra, undefined);
  assert.match(saved.reason, /验证码要求/);
  let run = f.store.run(d.id);
  assert.deepEqual(run.commentPublication.platformFeedback, saved.platformFeedback);
  assert.match(readFileSync(join(f.workspacePath, run.notePath), 'utf8'), /审核通过后展示/);
  const reopened = new Store(join(f.root, 'state.sqlite'));
  assert.equal(JSON.parse(reopened.db.prepare('SELECT data FROM comment_drafts WHERE id=?').get(d.id).data).receiptCandidate, '555'); reopened.close();
  f.comments.verify(d.id); await f.comments.job;
  assert.equal(f.calls.find(c => c.method === 'comment_verify').p.receipt, '555');
  saved = f.comments.get(d.id); assert.equal(saved.state, 'sent'); assert.equal(saved.receipt, '555');
  assert.equal(saved.platformFeedback.replyState, 17, 'read-only lookup must not overwrite the original response evidence');
  await assert.rejects(f.send(saved), { code: 'COMMENT_DRAFT' });
  await f.controller.deleteRecord(d.id); assert.equal(f.comments.get(d.id).platformFeedback, undefined);
  assert.equal(f.comments.budget('123').attempts, 1); assert.equal(f.posts().length, 1);
});

test('a read-only result must match a saved candidate receipt and cannot promote a different comment', async t => {
  const f = await setup(t, {}, { call: (method, p) => {
    if (method === 'comment_publish') return { accountUid: p.expected_account, bvid: p.bvid, confirmed: false, receiptCandidate: '555' };
    if (method === 'comment_verify') return { accountUid: p.expected_account, bvid: p.bvid, confirmed: true, receipt: '556' };
  } });
  const d = await f.draft(); await f.send(d); f.comments.verify(d.id); await f.comments.job;
  assert.equal(f.comments.get(d.id).state, 'unknown'); assert.equal(f.comments.error.code, 'COMMENT_VERIFY');
  assert.equal(f.comments.get(d.id).receiptCandidate, '555'); assert.equal(f.posts().length, 1);
});

test('automatic publishing respects activity hours and persisted comment pause', async t => {
  const f = await setup(t, { commentMode: 'auto', activityStart: '01:00', activityEnd: '02:00' });
  const d = await f.draft(); f.comments.resume(); f.comments.tick(); await f.comments.job;
  assert.equal(f.posts().length, 0);
  f.controller.configure({ activityStart: '00:00', activityEnd: '00:00' });
  f.comments.pause();
  const restarted = new Comments(f.controller); assert.equal(restarted.paused, true);
  f.comments.resume(); f.comments.tick(); await f.comments.job;
  assert.equal(f.comments.get(d.id).state, 'sent'); assert.equal(f.posts().length, 1);
});

test('missing original workspace binding blocks publication before any platform POST', async t => {
  const f = await setup(t); const d = await f.draft();
  f.workspace.sessionIds = [];
  await assert.rejects(f.send(d), { code: 'BINDING_NOT_READY' }); assert.equal(f.posts().length, 0);
  assert.equal(f.comments.budget('123').attempts, 0); assert.equal(f.counters.create, 1);
});
