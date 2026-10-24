import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, BV } from './fixtures.mjs';
import { settingsHarness, flatten, nodeText } from './settings-harness.mjs';

test('private UI navigates people before messages, separates settings and preserves selection and history page on refresh', async t => {
  const f = fixture(t); await f.bind();
  f.controller.configure({ ownerAccountEnabled: true, ownerAccountUid: '789', ownerAccountName: '测试使用者' }); f.controller.social.setAccount('123');
  f.controller.social.contacts.put('123', '456', { name: '测试粉丝', fan: true });
  for (let n = 0; n < 14; n++) f.controller.social.contacts.saveMessage({ id: 'private-layout-' + n, accountUid: '123', uid: n === 13 ? '456' : '789',
    at: 100000 + n, state: 'sent', text: '测试来信' + n, draft: '测试回复' + n, evaluation: '测试理由' });
  const ui = await settingsHarness(f.controller); t.after(ui.close);
  let tree = ui.render(); ui.button(tree, '关系').props.onClick(); tree = ui.render();
  const region = id => flatten(tree).find(n => n?.props?.id === id);
  assert.equal(region('bili-people-messages').props.hidden, false);
  assert.equal(region('bili-people-settings').props.hidden, true); assert.equal(region('bili-people-contacts').props.hidden, true);
  assert.equal(flatten(region('bili-people-messages')).filter(n => n?.props?.className?.includes('dm-person') && n.type === 'button').length, 2);
  const messages = flatten(region('bili-people-messages')).filter(n => n?.props?.className === 'dm-message');
  assert.equal(messages.length, 10); assert.ok(messages.every(n => !n.props.open));
  assert.ok(messages.every(n => !nodeText(n).includes('UID 789')));
  const fanButton = flatten(tree).find(n => n?.type === 'button' && n.props.className === 'dm-person' && nodeText(n).includes('456'));
  await fanButton.props.onClick(); await ui.flush(); tree = ui.render();
  assert.equal(flatten(tree).filter(n => n?.props?.className === 'dm-message').length, 1);
  assert.match(nodeText(flatten(tree).find(n => n?.props?.className === 'dm-thread')), /测试来信13/);
  const ownerButton = flatten(tree).find(n => n?.type === 'button' && n.props.className?.includes('dm-person owner'));
  await ownerButton.props.onClick(); await ui.flush(); tree = ui.render();
  await ui.button(tree, '更早的10条').props.onClick(); await ui.flush(); tree = ui.render();
  assert.equal(flatten(tree).filter(n => n?.props?.className === 'dm-message').length, 3);
  await ui.poll(); tree = ui.render(); assert.equal(flatten(tree).filter(n => n?.props?.className === 'dm-message').length, 3);
  const nav = flatten(tree).find(n => n?.props?.['aria-label'] === '关系与私信分区'); ui.button(nav, '设置').props.onClick(); tree = ui.render();
  assert.equal(region('bili-people-settings').props.hidden, false); assert.equal(region('bili-people-messages').props.hidden, true);
  assert.ok(ui.calls.every(c => c.action === 'status')); assert.equal(f.counters.read, 0); assert.equal(f.counters.prompt, 0);
});

test('interaction UI shows limits outside collapsed settings and filters automatic top/sub outcomes in place', async t => {
  const f = fixture(t); await f.bind(); f.controller.configure({ commentMode: 'auto' }); f.store.set('commentAccount', '123');
  for (const level of ['top', 'sub']) {
    const id = 'interaction-layout-' + level;
    f.store.start({ id, kind: 'interaction', bvid: BV, sessionId: f.store.get('binding').sessionId, accountUid: '123', now: 100000 });
    f.store.update(id, { state: 'preview', interactionTarget: { id: level === 'top' ? '101' : '201', root: '101', uid: '456', text: '测试原留言', level },
      commentPublication: { state: 'sent', text: '测试自动回复', reason: '模拟平台已接收' } });
  }
  const ui = await settingsHarness(f.controller); t.after(ui.close);
  let tree = ui.render(); ui.button(tree, '互动').props.onClick(); tree = ui.render();
  const panel = flatten(tree).find(n => n?.props?.id === 'bili-tab-interaction');
  const limits = flatten(panel).find(n => n?.props?.className === 'interaction-policy'); assert.ok(limits);
  assert.equal(limits.type, 'div'); assert.match(nodeText(limits), /楼中楼上限/);
  assert.equal(flatten(tree).find(n => n?.props?.id === 'bili-interaction-activity').props.hidden, false);
  assert.equal(flatten(tree).find(n => n?.props?.id === 'bili-interaction-settings').props.hidden, true);
  assert.equal(flatten(panel).filter(n => n?.props?.className === 'interaction-result').length, 2);
  const nav = flatten(tree).find(n => n?.props?.['aria-label'] === '互动记录类型');
  await ui.button(nav, '楼中楼 1').props.onClick(); await ui.flush(); tree = ui.render();
  const results = flatten(tree).filter(n => n?.props?.className === 'interaction-result');
  assert.equal(results.length, 1); assert.match(nodeText(results[0]), /楼中楼/); assert.match(nodeText(results[0]), /测试自动回复/);
  assert.match(nodeText(results[0]), /模拟平台已接收/);
  const sections = flatten(tree).find(n => n?.props?.['aria-label'] === '评论互动分区'); ui.button(sections, '互动设置').props.onClick(); tree = ui.render();
  assert.equal(flatten(tree).find(n => n?.props?.id === 'bili-interaction-settings').props.hidden, false);
  assert.ok(ui.calls.every(c => c.action === 'status')); assert.equal(f.counters.prompt, 0); assert.equal(f.counters.read, 0);
});
