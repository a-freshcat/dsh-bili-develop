import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, BV } from './fixtures.mjs';
import { settingsHarness, flatten, nodeText } from './settings-harness.mjs';

test('each accepted comment exposes visibility and mention uncertainty beside its own readonly verification', async t => {
  const f=fixture(t);await f.bind();f.store.set('commentAccount','123');
  f.controller.comments.save({id:'receipt-only',accountUid:'123',bvid:BV,state:'sent',text:'收到回执。',receipt:'555',mentions:[{uid:'456',name:'对象'}],mentionState:'rendered'});
  const ui=await settingsHarness(f.controller);t.after(ui.close);let tree=ui.render();
  const card=()=>flatten(tree).find(n=>n?.props?.['data-published-comment']==='receipt-only');
  assert.match(nodeText(card()),/公开可见性未确认/);
  assert.match(nodeText(card()),/回执含提及信息，通知是否到达/);
  assert.ok(ui.button(card(),'只读核对可见性'));
  f.controller.comments.save({...f.controller.comments.get('receipt-only'),publicList:{state:'not_in_sample',sampleCount:0,checkedAt:Date.now()}});
  await ui.poll();tree=ui.render();assert.match(nodeText(card()),/未登录最新评论样本未见/);
  assert.equal(ui.button(card(),'发送这条评论'),undefined);
  assert.ok(ui.calls.every(c=>c.action==='status'));assert.equal(f.counters.read,0);
});

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

test('record categories are parallel and publication history is absent from the interaction settings', async t => {
  const f = fixture(t); await f.bind(); f.store.set('commentAccount', '123');
  const ui = await settingsHarness(f.controller); t.after(ui.close);
  const byId = (root, id) => flatten(root).find(n => n?.props?.id === id);
  let tree = ui.render(); ui.button(tree, '记录').props.onClick(); tree = ui.render();
  const nav = flatten(tree).find(n => n?.props?.['aria-label'] === '记录分区');
  assert.deepEqual(flatten(nav).filter(n => n?.type === 'button').map(nodeText), ['浏览记录', '互动记录', '已发评论', '待处理', '账号管理']);
  const ids = ['bili-history-browse', 'bili-history-interactions', 'bili-published-comments', 'bili-history-pending', 'bili-history-account'];
  for (const [i, label] of ['浏览记录', '互动记录', '已发评论', '待处理', '账号管理'].entries()) {
    flatten(flatten(tree).find(n=>n?.props?.['aria-label']==='记录分区')).find(n=>n?.type==='button'&&nodeText(n)===label).props.onClick(); tree = ui.render();
    ids.forEach((id, index) => assert.equal(byId(tree, id).props.hidden, index !== i));
  }
  ui.button(tree, '互动').props.onClick(); tree = ui.render();
  const interaction = byId(tree, 'bili-tab-interaction');
  assert.ok(!flatten(interaction).some(n => n?.props?.id === 'bili-published-comments'));
  assert.ok(!flatten(interaction).some(n => n?.props?.id === 'bili-history-interactions'));
  assert.ok(flatten(interaction).some(n => n?.props?.id === 'bili-interaction-settings'));
  assert.ok(ui.calls.every(c => c.action === 'status')); assert.equal(f.counters.prompt, 0); assert.equal(f.counters.read, 0);
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
