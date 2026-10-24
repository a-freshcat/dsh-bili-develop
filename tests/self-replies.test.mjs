import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, preview, BV } from './fixtures.mjs';
import { settingsHarness, flatten, nodeText } from './settings-harness.mjs';

async function setup(t, config = {}) {
  const clock = { now: Date.parse('2026-10-25T04:00:00Z') }, calls = [];
  const f = fixture(t, { now: () => clock.now, output: (text, id) => {
    if (id.startsWith('reply-')) {
      const { target } = JSON.parse(text.split('\n').at(-1));
      return JSON.stringify({ ...preview(id), comment: '谢谢你的具体建议，我再琢磨一下。', evidence_quote: target.text });
    }
    return JSON.stringify(preview(id));
  }, call: async (method, p) => {
    calls.push({ method, p });
    if (method === 'read_video') return f.evidence;
    if (method === 'account') return { status: 'logged_in', uid: '123' };
    if (method === 'comment_feedback') return { accountUid: '123', bvid: BV, commentId: p.comment_id, replies: p.comment_id === '555' ? f.rows : [] };
    if (method === 'comment_reply_probe') return { accountUid: '123', bvid: BV, oid: '987', mentions: [], target: p.target };
    if (method === 'comment_reply_publish') return { accountUid: '123', bvid: BV, oid: '987', mentions: [], target: p.target, confirmed: true, receipt: '888' };
    throw new Error(method);
  } });
  await f.bind();
  await f.controller.start({ requestId: 'own-source', bvid: BV }); await f.controller.idle();
  f.controller.comments.save({ ...f.controller.comments.get('own-source'), state: 'sent', receipt: '555', attemptedAt: clock.now - 5000 });
  f.controller.configure({ selfCommentReplyEnabled: true, interactionKeywords: [], learningEnabled: false, commentMinIntervalSeconds: 60, ...config });
  clock.now += 1000;
  f.rows = ['601', '602'].map(id => ({ id, root: '555', parent: '555', uid: '456', text: '这句话可以再自然一点呀。', at: clock.now, level: 'sub' }));
  return Object.assign(f, { clock, calls, replies: () => f.store.list(100).filter(r => r.kind === 'interaction'),
    scan: async () => { f.controller.selfReplies.scan(); await f.controller.selfReplies.job; await f.controller.idle(); } });
}

test('a direct reply to a confirmed own comment needs no keyword or learning switch and obeys per-check sublimit and dedup', async t => {
  const f = await setup(t); await f.scan();
  assert.equal(f.replies().length, 1); assert.equal(f.replies()[0].interactionTrigger, 'self_reply');
  assert.equal(f.replies()[0].interactionTarget.id, '601'); assert.equal(f.counters.create, 1);
  assert.equal(f.calls.filter(c => c.method.includes('publish')).length, 0, 'preview remains preview');
  await f.scan(); assert.equal(f.replies().length, 2);
  await f.scan(); assert.equal(f.replies().length, 2, 'each received reply is evaluated once');
});

test('direct reply gates reject history, other parents, self and wrong accounts; zero sublimit prevents reading', async t => {
  const f = await setup(t);
  f.rows = [{ ...f.rows[0], at: f.clock.now - 10000 }, { ...f.rows[0], id: '603', parent: '999' }, { ...f.rows[0], id: '604', uid: '123' }];
  await f.scan(); assert.equal(f.replies().length, 0);
  f.controller.configure({ interactionSubLimit: 0 }); const before = f.calls.length;
  f.controller.selfReplies.tick(); assert.equal(f.calls.length, before);
});

test('self reply auto sending shares total quota, preflight parent proof, cooldown and disabled-switch stale protection', async t => {
  const f = await setup(t, { commentMode: 'auto', dailyCommentLimit: 1 });
  await f.scan(); f.controller.comments.tick(); await f.controller.comments.job;
  assert.equal(f.calls.filter(c => c.method === 'comment_reply_publish').length, 1);
  assert.equal(f.calls.find(c => c.method === 'comment_reply_probe').p.self_reply_parent, '555');
  f.clock.now += 60000; await f.scan(); await f.scan(); f.controller.comments.tick(); await f.controller.comments.job;
  assert.equal(f.calls.filter(c => c.method === 'comment_reply_publish').length, 1, 'daily quota still applies');
  const d = f.replies().find(r => r.interactionTarget.id === '602').commentPublication;
  f.controller.configure({ selfCommentReplyEnabled: false });
  await assert.rejects(f.controller.comments.send(d.id, d.revision), { code: 'INTERACTION_DISABLED' });
});

test('direct reply polling obeys activity, pause, evaluation cap and account identity, and clearing the original blocks pending sending', async t => {
  const f = await setup(t, { commentMode: 'manual' });
  f.controller.comments.pause(); f.controller.selfReplies.tick(); assert.equal(f.calls.filter(c => c.method === 'comment_feedback').length, 0);
  f.controller.comments.resume(); await f.scan();
  const d = f.replies()[0].commentPublication;
  f.controller.comments.save({ ...f.controller.comments.get('own-source'), contentCleared: true, text: '' });
  await assert.rejects(f.controller.comments.send(d.id, d.revision), { code: 'INTERACTION_DISABLED' });
  f.controller.configure({ dailyInteractionEvaluationLimit: 0 }); const count = f.calls.length;
  f.controller.selfReplies.tick(); assert.equal(f.calls.length, count);
  f.controller.configure({ dailyInteractionEvaluationLimit: 20, activityStart: '00:00', activityEnd: '01:00' });
  f.controller.selfReplies.tick(); assert.equal(f.calls.length, count, 'automatic checks follow activity window');
  const g = await setup(t), reader = g.controller.reader;
  g.controller.reader = () => ({ call: async (method, p) => method === 'comment_feedback' ? { accountUid: '999', bvid: BV, commentId: '555', replies: g.rows } : reader().call(method, p) });
  await g.scan(); assert.equal(g.replies().length, 0); assert.match(g.controller.selfReplies.status().notice, /不属于/);
});

test('interaction UI distinguishes keyword roots from direct own-comment replies with a collapsed optional setting', async t => {
  const f = await setup(t), ui = await settingsHarness(f.controller); t.after(ui.close);
  let tree = ui.render(); ui.button(tree, '互动').props.onClick(); tree = ui.render();
  assert.match(nodeText(tree), /关键词只触发普通评论/); assert.match(nodeText(tree), /直接回复检查已开启/);
  ui.button(tree, '互动设置').props.onClick(); tree = ui.render();
  const section = flatten(tree).find(n => n?.type === 'details' && n.children?.some(c => c?.type === 'summary' && nodeText(c) === '自己评论的直接回复'));
  assert.ok(section); assert.ok(!section.props.open); assert.match(nodeText(section), /默认1/);
});
