import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, BV } from './fixtures.mjs';
import { settingsHarness, flatten, nodeText } from './settings-harness.mjs';

test('published comments combine top-level and nested replies, paginate and search saved rows, and isolate accounts', async t => {
  const f = fixture(t); await f.bind(); f.store.set('commentAccount', '123');
  for (let i = 0; i < 14; i++) f.controller.comments.save({ id: 'posted-' + i, accountUid: '123', bvid: BV,
    kind: i % 2 ? 'interaction' : 'video', state: 'sent', text: '已发文字' + i + '。', receipt: String(100 + i),
    ...(i % 2 ? { target: { id: '77', root: '55', uid: '456', text: '收到', level: i === 1 ? 'top' : 'sub' } } : {}) });
  for (const state of ['unknown', 'failed', 'draft']) f.controller.comments.save({ id: state, accountUid: '123', bvid: BV, state, text: '不能当作已发', receipt: '999' });
  f.controller.comments.save({ id: 'other-account', accountUid: '999', bvid: BV, state: 'sent', text: '另一个账号的内容', receipt: '999' });
  const first = (await f.controller.status()).comments.published;
  assert.equal(first.total, 14); assert.equal(first.rows.length, 10); assert.ok(first.rows.some(d => d.target));
  assert.ok(first.rows.every(d => d.state === 'sent' && d.accountUid === '123'));
  const second = (await f.controller.status({ publishedView: { offset: 10 } })).comments.published;
  assert.equal(second.rows.length, 4); assert.ok(second.rows.every(d => !first.rows.some(a => a.id === d.id)));
  assert.equal(f.controller.comments.published({ q: '已发文字3。' }).rows[0].id, 'posted-3');
  assert.equal(f.controller.comments.published({ q: '%' }).total, 0, 'search is literal, not SQL wildcard expansion');
  assert.ok(f.controller.comments.status().recent.every(d => d.accountUid === '123'));
  f.store.set('commentAccount', '999');
  const switched = f.controller.comments.published({ account: '123', offset: 10, q: '已发文字' });
  assert.equal(switched.offset, 0); assert.equal(switched.q, ''); assert.deepEqual(switched.rows.map(d => d.id), ['other-account']);
  assert.throws(() => f.controller.comments.published({ offset: -1 }), { code: 'COMMENT_PAGE' });
  assert.throws(() => f.controller.comments.published({ q: 'x'.repeat(101) }), { code: 'COMMENT_PAGE' });
});

test('published view and nested-reply controls follow their tabs, and settings stay below the interaction feed', async t => {
  const f = fixture(t); await f.bind();
  f.store.set('commentAccount', '123');
  for (const level of ['top', 'sub']) {
    const id = 'published-layout-' + level;
    f.store.start({ id, kind: 'interaction', bvid: BV, sessionId: f.store.get('binding').sessionId, accountUid: '123', now: 100000 });
    f.store.update(id, { state: 'preview', interactionTarget: { id: level === 'top' ? '101' : '201', root: '101', uid: '456', text: '测试原留言', level },
      commentPublication: { state: 'sent', text: '测试回复', reason: '模拟' } });
  }
  const ui = await settingsHarness(f.controller); t.after(ui.close);
  let tree = ui.render();
  const byId = (root, id) => flatten(root).find(n => n?.props?.id === id);
  // The interaction feed is on the record tab; the interaction tab keeps the
  // published list and the settings panes.
  ui.button(tree, '记录').props.onClick(); tree = ui.render();
  const history = byId(tree, 'bili-history-interactions');
  assert.ok(history); assert.equal(history.props.open, true);
  assert.ok(!flatten(history).some(n => n?.props?.className === 'interaction-policy'));
  ui.button(tree, '互动').props.onClick(); tree = ui.render();
  const settings = byId(tree, 'bili-interaction-settings');
  assert.equal(settings.props.hidden, true);
  assert.equal(byId(tree, 'bili-published-comments').props.hidden, false);
  assert.ok(!byId(tree, 'bili-interaction-activity'));
  const filter = (root, prefix) => flatten(root).find(n => n?.type === 'button' && n.props.role === 'tab' && nodeText(n).startsWith(prefix + ' '));
  // The self-reply control block sits in the reply settings pane, which is now
  // the only home for it after the interaction feed moved to the record tab.
  ui.button(tree, '记录').props.onClick(); tree = ui.render();
  await filter(tree, '普通留言').props.onClick(); await ui.flush(); tree = ui.render();
  ui.button(tree, '互动').props.onClick(); tree = ui.render();
  ui.button(tree, '互动设置').props.onClick(); tree = ui.render();
  ui.button(tree, '接话规则').props.onClick(); tree = ui.render();
  assert.ok(byId(tree, 'bili-self-reply-controls'));
  assert.match(nodeText(byId(tree, 'bili-self-reply-controls')), /直接回复检查/);
  ui.button(tree, '记录').props.onClick(); tree = ui.render();
  await filter(tree, '楼中楼').props.onClick(); await ui.flush(); tree = ui.render();
  ui.button(tree, '互动').props.onClick(); tree = ui.render();
  ui.button(tree, '互动设置').props.onClick(); tree = ui.render();
  ui.button(tree, '接话规则').props.onClick(); tree = ui.render();
  assert.ok(byId(tree, 'bili-self-reply-controls'));
  assert.equal(byId(tree, 'bili-interaction-settings').props.hidden, false);
  // 接话规则 is the replies pane; the send pane is the other sibling.
  assert.equal(byId(tree, 'bili-interaction-settings-replies').props.hidden, false);
  assert.equal(byId(tree, 'bili-interaction-settings-send').props.hidden, true);
  ui.button(tree, '已发评论').props.onClick(); tree = ui.render();
  assert.equal(byId(tree, 'bili-published-comments').props.hidden, false);
  assert.equal(byId(tree, 'bili-interaction-settings').props.hidden, true);
  assert.equal(ui.calls.filter(c => !['status'].includes(c.action)).length, 0, 'changing tabs never posts or starts a model');
});

test('stale-policy error offers a jump carrying the original BV without reading or publishing until the user acts', async t => {
  const f = fixture(t); await f.bind();
  await f.controller.start({ requestId: 'stale-source', bvid: BV }); await f.controller.idle();
  f.controller.configure({ persona: '修改后的基础人设' });
  const ui = await settingsHarness(f.controller); t.after(ui.close);
  let tree = ui.render(); ui.button(tree, '记录').props.onClick(); tree = ui.render();
  await ui.button(tree, '检查发送对象（只读）').props.onClick(); await f.controller.comments.job; await ui.poll(); tree = ui.render();
  const recovery = ui.button(tree, '去重新读取'); assert.ok(recovery);
  const calls = ui.calls.length, prompts = f.counters.prompt;
  recovery.props.onClick(); tree = ui.render();
  const manual = flatten(tree).find(n => n?.props?.id === 'bili-manual-read');
  assert.equal(manual.props.hidden, false);
  assert.equal(flatten(manual).find(n => n?.type === 'input').props.value, BV);
  assert.equal(ui.calls.length, calls); assert.equal(f.counters.prompt, prompts);
  assert.equal(f.controller.comments.get('stale-source').state, 'draft');
});
