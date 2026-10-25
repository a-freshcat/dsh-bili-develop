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
    if (method === 'interaction_scan') return { accountUid: '123', bvid: BV, matches: [{ id: '101', root: '101', uid: '456', text: '鱼来', level: 'top' }], topRead: 1, subRead: 0 };
    if (method === 'comment_feedback') return { accountUid: '123', bvid: BV, commentId: p.comment_id, replies: ['555', '888'].includes(p.comment_id) ? f.rows : [] };
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

test('someone answering a sent keyword interaction can continue the conversation without repeating the keyword', async t => {
  const f = await setup(t, { interactionKeywords: ['鱼来'], commentMode: 'manual' });
  await f.controller.interactions.inspect(f.store.run('own-source'));
  await f.controller.idle();
  const initial = f.replies()[0]; assert.equal(initial.interactionTrigger, 'keyword');
  await f.controller.comments.send(initial.id, initial.commentPublication.revision);
  const sent = f.controller.comments.get(initial.id); assert.equal(sent.state, 'sent'); assert.equal(sent.target.root, '101');
  f.clock.now += 1000;
  f.rows = [{ id: '701', root: '101', parent: '888', uid: '456', text: '谢谢，你刚才说得很有趣。', at: f.clock.now, level: 'sub' }];
  await f.scan();
  assert.ok(f.calls.some(c => c.method === 'comment_feedback' && c.p.comment_id === '888' && c.p.root_id === '101'));
  const reply = f.replies().find(r => r.interactionTrigger === 'self_reply');
  assert.equal(reply.interactionTarget.id, '701'); assert.equal(reply.selfReplyReceipt, '888');
  assert.equal(f.replies().length, 2, 'one new conversation reply respects the per-check sublimit');
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

test('interaction UI distinguishes keyword roots from direct own-comment replies in the flat reply settings page', async t => {
  const f = await setup(t), ui = await settingsHarness(f.controller); t.after(ui.close);
  let tree = ui.render(); ui.button(tree, '互动').props.onClick(); tree = ui.render();
  // The interaction tab now opens on the published list; the reply-level switch
  // and its explanation live in the interaction settings pane.
  ui.button(tree, '互动设置').props.onClick(); tree = ui.render();
  ui.button(tree, '接话规则').props.onClick(); tree = ui.render();
  assert.match(nodeText(tree), /关键词只找浏览视频中的普通留言/); assert.match(nodeText(tree), /直接回复检查已开启/);
  assert.match(nodeText(tree), /包括大肥鱼通过关键词互动发出的回复/);
  const section = flatten(tree).find(n => n?.props?.id === 'bili-interaction-settings-replies');
  assert.ok(section); assert.equal(section.props.hidden, false);
  assert.match(nodeText(section), /已保存：普通留言 1 · 楼中楼 1/); assert.match(nodeText(section), /关键词互动/);
  assert.ok(!flatten(section).some(n => n?.type === 'details'), 'reply settings do not require nested accordions');
});

test('the disabled scan explains its switch and the inline enable action preserves other saved settings and unsaved edits', async t => {
  const f = await setup(t, { selfCommentReplyEnabled: false, keywords: ['原搜索词'], interactionKeywords: ['鱼来'],
    browseTags: ['动画'], privacyBlockedTerms: ['保密短语'] });
  const ui = await settingsHarness(f.controller); t.after(ui.close);
  let tree = ui.render(); ui.button(tree, '互动').props.onClick(); tree = ui.render();
  ui.button(tree, '互动设置').props.onClick(); tree = ui.render();
  ui.button(tree, '接话规则').props.onClick(); tree = ui.render();
  assert.equal(ui.button(tree, '检查自己评论的回复').props.disabled, true);
  assert.match(nodeText(tree), /尚未开启，点击“开启直接回复检查”/);
  const topField = root => flatten(root).find(n => n?.type === 'label' && nodeText(n).startsWith('普通留言上限'));
  flatten(topField(tree)).find(n => n?.type === 'input').props.onChange({ target: { value: '2' } }); tree = ui.render();
  await ui.button(tree, '开启直接回复检查').props.onClick(); await ui.flush(); tree = ui.render();
  assert.equal(f.store.config().selfCommentReplyEnabled, true);
  assert.deepEqual(Object.keys(ui.calls.find(c => c.action === 'configure').config), ['selfCommentReplyEnabled']);
  assert.deepEqual(f.store.config().interactionKeywords, ['鱼来']); assert.deepEqual(f.store.config().keywords, ['原搜索词']);
  assert.deepEqual(f.store.config().browseTags, ['动画']); assert.deepEqual(f.store.config().privacyBlockedTerms, ['保密短语']);
  assert.equal(f.store.config().interactionTopLimit, 1);
  assert.equal(flatten(topField(tree)).find(n => n?.type === 'input').props.value, 2, 'unsaved edits stay in the form');
  assert.equal(ui.button(tree, '检查自己评论的回复').props.disabled, false);
});
