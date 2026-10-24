import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, preview, BV } from './fixtures.mjs';
import { configOf } from '../src/decision.mjs';
import { inActivity, nextActivity } from '../src/time.mjs';
import { DEFAULT_CONFIG } from '../src/store.mjs';
import { Comments } from '../src/comments.mjs';

const row = (id, level = 'top', text = '鱼来') => ({ id, root: level === 'top' ? id : '101', uid: '456', level, text, name: '留言者' });
const ownerSubs = { ownerAccountEnabled: true, ownerAccountUid: '456', ownerCommentReplyEnabled: true };
const ownerRows = [row('101'), row('102'), { ...row('201', 'sub'), mentionedUids: ['123'] }, { ...row('202', 'sub'), mentionedUids: ['123'] }];
async function setup(t, config = {}, hooks = {}) {
  let now = Date.parse('2026-10-23T04:00:00Z'), serial = 0;
  const calls = [], prompts = [];
  const f = fixture(t, { now: () => now, output: (text, id) => {
    prompts.push(text);
    if (text.includes('评论区关键词互动的一次只读判断')) {
      const { target } = JSON.parse(text.split('\n').at(-1));
      return JSON.stringify({ ...preview(id), summary: '留言互动', comment: '我来啦，有什么想聊的？' + target.id, evidence_quote: target.text,
        should_comment: !hooks.decline, ...(hooks.decline ? { comment: '' } : {}), mention_uids: [] });
    }
    return JSON.stringify({ ...preview(id), ...(hooks.videoDecline ? { should_comment: false, comment: '' } : {}) });
  }, call: async (method, p) => {
    calls.push({ method, p });
    if (hooks.call) { const result = await hooks.call(method, p); if (result !== undefined) return result; }
    if (method === 'read_video') return { ...f.evidence, bvid: p.bvid };
    const found = { bvid: p.bvid, accountUid: p.expected_account, oid: '987', mentions: p.mentions || [] };
    if (method === 'interaction_scan') return { ...found, matches: hooks.rows || [row('101'), row('102'), row('201', 'sub'), row('202', 'sub'), { ...row('103'), uid: '123' }, row('104', 'top', '没有关键词')], topRead: 5, subRead: 2, failedThreads: 0 };
    if (method === 'comment_reply_probe') return { ...found, target: p.target };
    if (method === 'comment_reply_publish') return { ...found, target: p.target, confirmed: true, receipt: '555' };
    if (method === 'comment_reply_verify') return { ...found, target: p.target, confirmed: false };
    throw new Error(method);
  } });
  await f.bind(); f.controller.configure({ interactionKeywords: ['鱼来'], commentMinIntervalSeconds: 60, ...config });
  const browse = async () => { const id = 'interaction-video-' + ++serial; await f.controller.start({ requestId: id, bvid: BV }); await f.controller.idle(); return f.store.run(id); };
  return { ...f, calls, prompts, browse, advance(ms = 60000) { now += ms; }, replies() { return f.store.list(100).filter(r => r.kind === 'interaction'); },
    posts() { return calls.filter(c => c.method === 'comment_reply_publish'); } };
}

test('empty keywords do not scan, evaluate or reply to other people', async t => {
  const f = await setup(t, { interactionKeywords: [] }); await f.browse();
  assert.equal(f.calls.filter(c => c.method === 'interaction_scan').length, 0);
  assert.equal(f.replies().length, 0); assert.equal(f.counters.prompt, 1); assert.equal(f.posts().length, 0);
});

test('owner platform mention independently triggers, has priority, and does not expose owner UID to the public model prompt', async t => {
  const owner = '765432109876';
  const f = await setup(t, { ownerAccountEnabled: true, ownerAccountUid: owner, ownerCommentReplyEnabled: true, interactionSubLimit: 0 },
    { rows: [row('101'), { ...row('102', 'top', '@大肥鱼 这个怎么样？'), uid: owner, mentionedUids: ['123'] }] });
  await f.browse();
  assert.equal(f.replies().length, 1); const r = f.replies()[0];
  assert.equal(r.interactionTarget.id, '102'); assert.equal(r.interactionTrigger, 'owner_mention');
  assert.equal(f.calls.find(c => c.method === 'interaction_scan').p.owner_mention_uid, owner);
  assert.ok(!f.prompts.find(p => p.includes('关键词互动的一次')).includes(owner));
  assert.equal(f.posts().length, 0);
  const g = await setup(t, { interactionKeywords: [], ownerAccountEnabled: true, ownerAccountUid: owner, ownerCommentReplyEnabled: true },
    { rows: [{ ...row('103', 'top', '@大肥鱼 来看看'), uid: owner, mentionedUids: ['123'] }] });
  await g.browse(); assert.equal(g.replies().length, 1);
});

test('fake nickname, other author, wrong mentioned account and disabled owner identity never trigger', async t => {
  const rows = [{ ...row('101', 'top', '@大肥鱼 来看看'), uid: '789' },
    { ...row('102', 'top', '@大肥鱼 来看看'), uid: '789', mentionedUids: ['999'] },
    { ...row('103', 'top', '@大肥鱼 来看看'), uid: '456', mentionedUids: ['123'] }];
  const f = await setup(t, { interactionKeywords: [], ownerAccountEnabled: true, ownerAccountUid: '789', ownerCommentReplyEnabled: true }, { rows });
  await f.browse(); assert.equal(f.replies().length, 0);
  f.controller.configure({ ownerAccountEnabled: false }); await f.browse();
  assert.equal(f.calls.filter(c => c.method === 'interaction_scan').length, 1);
});

test('owner reply sending rechecks mention via probe and publish; disabling invalidates the draft', async t => {
  const f = await setup(t, { interactionKeywords: [], ownerAccountEnabled: true, ownerAccountUid: '789', ownerCommentReplyEnabled: true, commentMode: 'manual' },
    { rows: [{ ...row('101', 'top', '@大肥鱼 来看看'), uid: '789', mentionedUids: ['123'] }] });
  await f.browse(); const d = f.replies()[0].commentPublication;
  await f.controller.comments.send(d.id, d.revision);
  for (const call of f.calls.filter(c => ['comment_reply_probe', 'comment_reply_publish'].includes(c.method))) assert.equal(call.p.owner_mention_uid, '789');
  const g = await setup(t, { interactionKeywords: [], ownerAccountEnabled: true, ownerAccountUid: '789', ownerCommentReplyEnabled: true, commentMode: 'manual' },
    { rows: [{ ...row('102', 'top', '@大肥鱼 来看看'), uid: '789', mentionedUids: ['123'] }] });
  await g.browse(); const draft = g.replies()[0].commentPublication;
  g.controller.configure({ ownerCommentReplyEnabled: false });
  await assert.rejects(g.controller.comments.send(draft.id, draft.revision), { code: 'INTERACTION_DISABLED' });
});
test('keyword browsing evaluates ordinary comments only, not unrelated keyword subreplies, in the sole dialogue', async t => {
  const f = await setup(t); const source = await f.browse(); const replies = f.replies();
  assert.equal(replies.length, 1); assert.deepEqual(replies.map(r => r.interactionTarget.level), ['top']);
  assert.equal(f.counters.create, 1); assert.equal(f.counters.prompt, 2);
  assert.equal(f.controller.scheduler.status().budget.analyses, 1);
  assert.equal(f.controller.interactions.budget('123').evaluations, 1);
  assert.ok(replies.every(r => r.sessionId === source.sessionId && r.state === 'preview' && r.commentPublication.state === 'draft'));
  assert.equal(source.interactionScan.matches.length, 2, 'self-authored, nonmatching and unrelated subreply text are excluded');
  assert.equal(f.posts().length, 0); assert.equal(f.controller.metadataBusy, false);
  assert.match(f.prompts.find(p => p.includes('关键词互动的一次')), /外部内容/);
});
test('zero and custom per-type limits are independent and duplicates are not evaluated again', async t => {
  const f = await setup(t, { ...ownerSubs, interactionTopLimit: 0, interactionSubLimit: 1 }, { rows: ownerRows }); await f.browse();
  assert.equal(f.replies().length, 1); assert.equal(f.replies()[0].interactionTarget.level, 'sub');
  await f.browse(); assert.equal(f.replies().length, 2, 'next eligible subreply may be selected');
  await f.browse(); assert.equal(f.replies().length, 2); assert.equal(f.counters.prompt, 5);
  const g = await setup(t, { interactionTopLimit: 0, interactionSubLimit: 0 }); await g.browse();
  assert.equal(g.calls.filter(c => c.method === 'interaction_scan').length, 0);
});
test('daily evaluation budget caps extra model work, and model may decline a matching comment', async t => {
  const f = await setup(t, { dailyInteractionEvaluationLimit: 1 }); await f.browse(); await f.browse();
  assert.equal(f.replies().length, 1); assert.equal(f.counters.prompt, 3);
  const g = await setup(t, {}, { decline: true }); await g.browse();
  assert.equal(g.replies().length, 1); assert.ok(g.replies().every(r => !r.preview.should_comment && !r.commentPublication));
});
test('top and subreply attempts are independently capped but share daily public quota and cooldown', async t => {
  const f = await setup(t, { ...ownerSubs, commentMode: 'manual', dailyCommentLimit: 2 }, { rows: ownerRows }); await f.browse();
  const [a, b] = f.replies().map(r => r.commentPublication);
  await f.controller.comments.send(a.id, a.revision);
  await assert.rejects(f.controller.comments.send(b.id, b.revision), { code: 'COMMENT_COOLDOWN' });
  f.advance(); await f.controller.comments.send(b.id, b.revision);
  assert.equal(f.posts().length, 2); assert.equal(f.controller.comments.budget('123').attempts, 2);
  assert.notEqual(f.posts()[0].p.target.id, f.posts()[1].p.target.id);
  assert.ok(f.posts().every(p => p.p.target.uid === '456' && p.p.mentions.length === 0));
});
test('clearing or changing keywords, lowering a type limit or deleting source blocks queued replies', async t => {
  const f = await setup(t, { commentMode: 'manual' }); const source = await f.browse(); const d = f.replies()[0].commentPublication;
  f.controller.configure({ interactionKeywords: [] }); await assert.rejects(f.controller.comments.send(d.id, d.revision), { code: 'INTERACTION_DISABLED' });
  f.controller.configure({ interactionKeywords: ['鱼来'] }); await assert.rejects(f.controller.comments.send(d.id, d.revision), { code: 'INTERACTION_DISABLED' });
  await f.controller.deleteRecord(source.id); assert.equal(f.posts().length, 0);
  const g = await setup(t, { commentMode: 'manual' }); const parent = await g.browse(); const top = g.replies().find(r => r.interactionTarget.level === 'top').commentPublication;
  g.controller.configure({ interactionTopLimit: 0 }); await assert.rejects(g.controller.comments.send(top.id, top.revision), { code: 'INTERACTION_LIMIT' });
  g.controller.configure({ interactionTopLimit: 1 }); await g.controller.deleteRecord(parent.id);
  await assert.rejects(g.controller.comments.send(top.id, top.revision), { code: 'INTERACTION_DISABLED' });
});
test('account/target changes and uncertain sends never produce a second POST', async t => {
  let mismatch = true;
  const f = await setup(t, { commentMode: 'manual' }, { call: (method, p) => {
    if (method === 'comment_reply_probe' && mismatch) return { accountUid: '999', bvid: p.bvid, oid: '987', mentions: [], target: p.target };
    if (method === 'comment_reply_publish') throw new Error('timeout');
  } }); await f.browse(); const d = f.replies()[0].commentPublication;
  await assert.rejects(f.controller.comments.send(d.id, d.revision), { code: 'COMMENT_TARGET' });
  mismatch = false; await f.controller.comments.send(d.id, d.revision);
  assert.equal(f.controller.comments.get(d.id).state, 'unknown');
  await assert.rejects(f.controller.comments.send(d.id, d.revision), { code: 'COMMENT_DRAFT' }); assert.equal(f.posts().length, 1);
});
test('pausing while scanning stops replies, and normalised keywords match literal text only', async t => {
  let release;
  const f = await setup(t, {}, { call: (method, p) => method === 'interaction_scan' ? new Promise(resolve => { release = () => resolve({ accountUid: '123', bvid: p.bvid, matches: [row('101')] }); }) : undefined });
  const pending = f.browse(); while (!release) await new Promise(resolve => setImmediate(resolve));
  f.controller.scheduler.pause(); release(); await pending;
  assert.equal(f.replies().length, 0); assert.equal(f.controller.metadataBusy, false);
  const g = await setup(t, { interactionKeywords: ['ＦＩＳＨ'] }, { rows: [row('301', 'top', 'Fish，来聊聊')] }); await g.browse();
  assert.equal(g.replies().length, 1);
});
test('24-hour boundaries distinguish noon, midnight, end24 and overnight', () => {
  const config = configOf({ activityStart: '09:00', activityEnd: '24:00' }, DEFAULT_CONFIG);
  assert.equal(inActivity(Date.parse('2026-10-23T06:00:00Z'), { ...config, timeZone: 'Asia/Singapore' }), true);
  assert.equal(inActivity(Date.parse('2026-10-23T04:00:00Z'), { ...config, activityEnd: '12:00', timeZone: 'Asia/Singapore' }), false);
  assert.equal(inActivity(Date.parse('2026-10-23T16:00:00Z'), { ...config, timeZone: 'Asia/Singapore' }), false);
  assert.equal(nextActivity(Date.parse('2026-10-23T16:00:00Z'), { ...config, timeZone: 'Asia/Singapore' }), Date.parse('2026-10-24T01:00:00Z'));
  assert.equal(inActivity(Date.parse('2026-10-23T16:00:00Z'), { ...config, activityStart: '00:00', timeZone: 'Asia/Singapore' }), true);
  assert.equal(inActivity(Date.parse('2026-10-23T18:00:00Z'), { ...config, activityStart: '18:00', activityEnd: '09:00', timeZone: 'Asia/Singapore' }), true);
  for (const input of [{ activityStart: '24:00' }, { activityEnd: '24:30' }, { interactionTopLimit: -1 }]) assert.throws(() => configOf(input, DEFAULT_CONFIG));
});

test('automatic interaction sending waits for pause and global cooldown, then sends each type at most once', async t => {
  const f = await setup(t, { ...ownerSubs, commentMode: 'auto' }, { videoDecline: true, rows: ownerRows });
  f.controller.comments.pause(); await f.browse();
  f.controller.comments.tick(); assert.equal(f.posts().length, 0);
  f.controller.comments.resume(); f.controller.comments.tick(); await f.controller.comments.job;
  assert.equal(f.posts().length, 1);
  f.controller.comments.tick(); await f.controller.comments.job; assert.equal(f.posts().length, 1);
  f.advance(); f.controller.comments.tick(); await f.controller.comments.job;
  assert.equal(f.posts().length, 2);
  const visible = f.controller.interactions.status().records;
  assert.equal(visible.rows.length, 2); assert.ok(visible.rows.every(r => r.state === 'sent'));
  assert.deepEqual(visible.rows.map(r => r.target.level).sort(), ['sub', 'top']);
  f.advance(); f.controller.comments.tick(); await f.controller.comments.job; assert.equal(f.posts().length, 2);
});

test('interaction page filters and pages every saved top/sub reply independently of mode and isolates accounts', async t => {
  const f = await setup(t, { commentMode: 'auto' });
  f.store.set('commentAccount', '123');
  for (let i = 0; i < 12; i++) {
    const account = i < 11 ? '123' : '999', id = 'synthetic-interaction-page-' + i;
    f.store.start({ id, kind: 'interaction', bvid: BV, accountUid: account, sessionId: f.store.get('binding').sessionId, now: 10000 + i });
    f.store.update(id, { state: 'preview', interactionTarget: row(String(1000 + i), i % 2 ? 'sub' : 'top'),
      configSnapshot: { privateHidden: 'must-not-forward' }, commentPublication: { state: i % 3 ? 'sent' : 'unknown', text: '回复' + i, reason: '本地记录状态' } });
  }
  const all = f.controller.interactions.status().records;
  assert.equal(all.total, 11); assert.equal(all.rows.length, 5); assert.deepEqual(all.counts, { top: 6, sub: 5 });
  const top = f.controller.interactions.status({ level: 'top', offset: 5 }).records;
  assert.equal(top.rows.length, 1); assert.ok(top.rows.every(r => r.target.level === 'top')); assert.equal(top.total, 6);
  const sub = f.controller.interactions.status({ level: 'sub' }).records;
  assert.equal(sub.rows.length, 5); assert.ok(sub.rows.every(r => r.target.level === 'sub'));
  assert.ok(!JSON.stringify(sub).includes('must-not-forward'));
  assert.equal(f.counters.prompt, 0); assert.equal(f.posts().length, 0);
  for (const view of [null, [], { level: 'other' }, { offset: -1 }, { extra: true }]) assert.throws(() => f.controller.interactions.status(view));
});

test('restart retains an uncertain reply and its type quota without a second POST', async t => {
  const f = await setup(t, { commentMode: 'manual' }); await f.browse();
  const d = f.controller.comments.get(f.replies()[0].id);
  f.controller.comments.reserve(d, false);
  const restarted = new Comments(f.controller);
  assert.equal(restarted.get(d.id).state, 'unknown'); assert.equal(restarted.budget('123').attempts, 1);
  restarted.verify(d.id); await restarted.job;
  assert.equal(restarted.get(d.id).state, 'unknown'); assert.equal(f.posts().length, 0);
});
