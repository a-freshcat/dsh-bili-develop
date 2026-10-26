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

test('interaction UI keeps limits out of the feed, exposes them in reply settings and filters automatic outcomes in place', async t => {
  const f = fixture(t); await f.bind(); f.controller.configure({ commentMode: 'auto' }); f.store.set('commentAccount', '123');
  for (const level of ['top', 'sub']) {
    const id = 'interaction-layout-' + level;
    f.store.start({ id, kind: 'interaction', bvid: BV, sessionId: f.store.get('binding').sessionId, accountUid: '123', now: 100000 });
    f.store.update(id, { state: 'preview', interactionTarget: { id: level === 'top' ? '101' : '201', root: '101', uid: '456', text: '测试原留言', level },
      commentPublication: { state: 'sent', text: '测试自动回复', reason: '模拟平台已接收' } });
  }
  const ui = await settingsHarness(f.controller); t.after(ui.close);
  let tree = ui.render();
  // Interaction outcomes now live on the record tab; the interaction tab keeps
  // only published comments and the reply settings.
  ui.button(tree, '记录').props.onClick(); tree = ui.render();
  const history = flatten(tree).find(n => n?.props?.id === 'bili-history-interactions');
  assert.ok(history, 'record tab must host the interaction record section');
  assert.equal(history.type, 'div');
  ui.button(tree, '互动记录').props.onClick(); tree = ui.render();
  assert.equal(flatten(tree).find(n => n?.props?.id === 'bili-history-interactions').props.hidden, false);
  assert.equal(flatten(tree).filter(n => n?.props?.className === 'interaction-result').length, 2);
  const nav = flatten(tree).find(n => n?.props?.['aria-label'] === '互动记录类型');
  await ui.button(nav, '楼中楼 1').props.onClick(); await ui.flush(); tree = ui.render();
  const results = flatten(tree).filter(n => n?.props?.className === 'interaction-result');
  assert.equal(results.length, 1); assert.match(nodeText(results[0]), /楼中楼/); assert.match(nodeText(results[0]), /测试自动回复/);
  assert.match(nodeText(results[0]), /模拟平台已接收/);
  // The interaction tab no longer offers an in-place record feed.
  ui.button(tree, '互动').props.onClick(); tree = ui.render();
  const panel = flatten(tree).find(n => n?.props?.id === 'bili-tab-interaction');
  assert.ok(!flatten(panel).some(n => n?.props?.className === 'interaction-result'));
  assert.ok(!flatten(panel).some(n => n?.props?.className === 'interaction-policy'));
  assert.ok(!flatten(panel).some(n => n?.props?.id === 'bili-published-comments'));
  assert.ok(flatten(panel).some(n => n?.props?.id === 'bili-interaction-settings'));
  ui.button(tree, '接话规则').props.onClick(); tree = ui.render();
  const replySettings = flatten(tree).find(n => n?.props?.id === 'bili-interaction-settings-replies');
  assert.equal(replySettings.props.hidden, false);
  assert.match(nodeText(replySettings), /普通留言上限（每次，0关闭）/); assert.match(nodeText(replySettings), /楼中楼上限（每次，0关闭）/);
  assert.ok(ui.calls.every(c => c.action === 'status')); assert.equal(f.counters.prompt, 0); assert.equal(f.counters.read, 0);
});

test('private schedule UI explains nighttime waiting and saves all-day private checks without changing browsing hours or sending', async t => {
  const f = fixture(t, { now: () => Date.parse('2026-10-25T00:05:00+08:00') }); await f.bind();
  f.controller.configure({ dmEnabled: true, dmAutoSend: true, dmUseBrowseHours: true, activityStart: '08:00', activityEnd: '23:00', timeZone: 'Asia/Singapore' });
  const ui = await settingsHarness(f.controller); t.after(ui.close);
  let tree = ui.render(); ui.button(tree, '关系').props.onClick(); tree = ui.render();
  const inbox = flatten(tree).find(n => n?.props?.id === 'bili-people-messages');
  assert.match(nodeText(inbox), /当前不在私信活动时段 08:00～23:00/); assert.match(nodeText(inbox), /自动发送已开启/);
  const nav = flatten(tree).find(n => n?.props?.['aria-label'] === '关系与私信分区'); ui.button(nav, '设置').props.onClick(); tree = ui.render();
  const label = flatten(tree).find(n => n?.type === 'label' && n.children.includes('私信自动检查沿用浏览活动时段（关闭则全天）'));
  const checkbox = flatten(label).find(n => n?.type === 'input'); assert.equal(checkbox.props.checked, true);
  checkbox.props.onChange({ target: { checked: false } }); tree = ui.render();
  await ui.button(tree, '保存私信设置').props.onClick(); await ui.flush(); tree = ui.render();
  assert.equal(f.store.config().dmUseBrowseHours, false); assert.equal(f.store.config().activityStart, '08:00'); assert.equal(f.store.config().activityEnd, '23:00');
  assert.equal(f.controller.social.schedule().code, 'due');
  assert.ok(ui.calls.every(c => ['status', 'configure'].includes(c.action))); assert.equal(f.counters.read, 0); assert.equal(f.counters.prompt, 0);
});
