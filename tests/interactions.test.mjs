import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, preview, BV } from './fixtures.mjs';
import { configOf } from '../src/decision.mjs';
import { inActivity, nextActivity } from '../src/time.mjs';
import { DEFAULT_CONFIG } from '../src/store.mjs';
import { Comments } from '../src/comments.mjs';

const row = (id, level = 'top', text = '鱼来') => ({ id, root: level === 'top' ? id : '101', uid: '456', level, text, name: '留言者' });
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
test('each browsed video evaluates at most one top comment and one subreply, in the sole dialogue', async t => {
  const f = await setup(t); const source = await f.browse(); const replies = f.replies();
  assert.equal(replies.length, 2); assert.deepEqual(replies.map(r => r.interactionTarget.level).sort(), ['sub', 'top']);
  assert.equal(f.counters.create, 1); assert.equal(f.counters.prompt, 3);
  assert.equal(f.controller.scheduler.status().budget.analyses, 1);
  assert.equal(f.controller.interactions.budget('123').evaluations, 2);
  assert.ok(replies.every(r => r.sessionId === source.sessionId && r.state === 'preview' && r.commentPublication.state === 'draft'));
  assert.equal(source.interactionScan.matches.length, 4, 'self-authored and nonmatching text are excluded');
  assert.equal(f.posts().length, 0); assert.equal(f.controller.metadataBusy, false);
  assert.match(f.prompts.find(p => p.includes('关键词互动的一次')), /外部内容/);
});
test('zero and custom per-type limits are independent and duplicates are not evaluated again', async t => {
  const f = await setup(t, { interactionTopLimit: 0, interactionSubLimit: 1 }); await f.browse();
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
  assert.equal(g.replies().length, 2); assert.ok(g.replies().every(r => !r.preview.should_comment && !r.commentPublication));
});
test('top and subreply attempts are independently capped but share daily public quota and cooldown', async t => {
  const f = await setup(t, { commentMode: 'manual', dailyCommentLimit: 2 }); await f.browse();
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
  const f = await setup(t, { commentMode: 'auto' }, { videoDecline: true });
  f.controller.comments.pause(); await f.browse();
  f.controller.comments.tick(); assert.equal(f.posts().length, 0);
  f.controller.comments.resume(); f.controller.comments.tick(); await f.controller.comments.job;
  assert.equal(f.posts().length, 1);
  f.controller.comments.tick(); await f.controller.comments.job; assert.equal(f.posts().length, 1);
  f.advance(); f.controller.comments.tick(); await f.controller.comments.job;
  assert.equal(f.posts().length, 2);
  f.advance(); f.controller.comments.tick(); await f.controller.comments.job; assert.equal(f.posts().length, 2);
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
