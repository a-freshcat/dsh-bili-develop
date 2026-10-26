import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, preview, BV } from './fixtures.mjs';
import { settingsHarness, flatten, nodeText } from './settings-harness.mjs';

async function setup(t) {
  const now = Date.parse('2026-10-26T04:00:00Z'), f = fixture(t, { now: () => now });
  await f.bind(); f.controller.social.setAccount('123'); f.controller.comments.kick = () => {};
  f.controller.configure({ commentMode: 'auto', commentPrivacyMode: 'content', dailyAnalysisLimit: 500, dmAutoSend: true });
  const add = (i, reason = '', automatic = true) => {
    const id = 'hub-video-' + String(i).padStart(2, '0');
    f.store.start({ id, kind: 'video', bvid: BV, accountUid: '123', sessionId: f.store.get('binding').sessionId, now: now + i });
    f.store.update(id, { state: 'preview', evidence: { ...f.evidence, title: '合成视频' + i }, preview: preview(id), configSnapshot: f.store.config() });
    const d = f.controller.comments.stage(id, [], false).publication;
    f.controller.comments.save({ ...f.controller.comments.get(d.id), autoEligible: automatic, ...(reason ? { reason } : {}) }, false);
    return id;
  };
  return { ...f, now, add };
}

test('manual queue identifies old entries ahead of newer automatic drafts, pages all entries and isolates accounts', async t => {
  const f = await setup(t);
  const first = f.add(0, '基础人设已变化，请重新读取并生成评价。'), second = f.add(1, '隐私审核未通过，需人工复审');
  for (let i = 2; i < 44; i++) f.add(i);
  f.controller.comments.save({ id: 'foreign-draft', accountUid: '999', bvid: BV, state: 'draft', text: 'FOREIGN_PRIVATE_MARKER', reason: '人工确认' }, false);
  f.controller.social.contacts.saveMessage({ id: 'foreign-message', accountUid: '999', uid: '456', at: f.now, state: 'failed', text: 'FOREIGN_PRIVATE_MARKER' });
  const manual = f.controller.history.pending();
  assert.equal(manual.total, 44); assert.equal(manual.manual, 2); assert.equal(manual.filteredTotal, 2);
  assert.deepEqual(new Set(manual.items.map(i => i.id)), new Set([first, second]));
  assert.ok(manual.items.every(i => i.title && i.manualReason && i.recordAvailable));
  assert.ok(!JSON.stringify(manual).includes('FOREIGN_PRIVATE_MARKER'));
  const all = f.controller.history.pending({ filter: 'all' }), next = f.controller.history.pending({ filter: 'all', offset: 8 });
  assert.equal(all.items.length, 8); assert.equal(next.items.length, 8);
  assert.ok(next.items.every(i => !all.items.some(previous => previous.id === i.id)));
  assert.throws(() => f.controller.history.pending({ filter: 'bogus' }), { code: 'HISTORY_PENDING' });
});

test('manual card opens the exact old record independently of the browse page, without publishing', async t => {
  const f = await setup(t), id = f.add(0, '基础人设已变化，请重新读取并生成评价。');
  f.add(1, '隐私审核未通过，需人工复审'); for (let i = 2; i < 13; i++) f.add(i);
  const ui = await settingsHarness(f.controller); t.after(ui.close);
  let tree = ui.render(); ui.button(tree, '记录').props.onClick(); tree = ui.render();
  await ui.button(tree, '查看待处理条目').props.onClick(); await ui.flush(); tree = ui.render();
  const pending = flatten(tree).find(n => n?.props?.id === 'bili-history-pending');
  assert.equal(pending.props.hidden, false);
  const cards = flatten(pending).filter(n => n?.props?.['data-pending-id']); assert.equal(cards.length, 2);
  const card = cards.find(n => n.props['data-pending-id'] === id); assert.match(nodeText(card), /合成视频0/);
  assert.match(nodeText(card), /设置或原文已变化/); assert.ok(!flatten(card).some(n => n?.type === 'details'));
  await ui.button(card, '查看这条评论并处理').props.onClick(); await ui.flush(); tree = ui.render();
  const focus = flatten(tree).find(n => n?.props?.id === 'bili-focused-record');
  const detail = flatten(focus).find(n => n?.props?.id === 'bili-focused-' + id);
  assert.equal(detail.props.open, true); assert.match(nodeText(detail), /合成视频0/);
  assert.ok(ui.calls.some(c => c.recordId === id)); assert.ok(ui.calls.every(c => c.action === 'status'));
  assert.equal(f.counters.prompt, 0); assert.equal(f.counters.read, 0);
});

test('pending private message locates its person, old page and expanded exact message without sending', async t => {
  const f = await setup(t); f.controller.social.contacts.put('123', '456', { name: '合成联系人', fan: true });
  f.controller.social.contacts.saveMessage({ id: 'old-private-pending', accountUid: '123', uid: '456', at: f.now, state: 'failed', text: '合成旧来信', reason: '生成失败' });
  for (let i = 1; i <= 13; i++) f.controller.social.contacts.saveMessage({ id: 'new-private-' + i, accountUid: '123', uid: '456', at: f.now + i, state: 'sent', text: '合成来信' });
  const ui = await settingsHarness(f.controller); t.after(ui.close);
  let tree = ui.render(); ui.button(tree, '记录').props.onClick(); tree = ui.render();
  await ui.button(tree, '查看待处理条目').props.onClick(); await ui.flush(); tree = ui.render();
  const card = flatten(tree).find(n => n?.props?.['data-pending-id'] === 'old-private-pending');
  assert.match(nodeText(card), /合成联系人/);
  await ui.button(card, '定位这条私信并处理').props.onClick(); await ui.flush(); tree = ui.render();
  const message = flatten(tree).find(n => n?.props?.id === 'bili-private-old-private-pending');
  assert.ok(message); assert.equal(message.props.open, true); assert.match(nodeText(message), /合成旧来信/);
  assert.ok(ui.calls.some(c => c.privateView?.uid === '456' && c.privateView.offset === 10));
  assert.ok(ui.calls.every(c => c.action === 'status')); assert.equal(f.counters.prompt, 0); assert.equal(f.counters.read, 0);
});

test('record focus omits private tasks, another account and cleared records', async t => {
  const f = await setup(t), id = f.add(1);
  assert.equal((await f.controller.status({ recordId: id })).record.id, id);
  f.controller.social.setAccount('999'); assert.equal((await f.controller.status({ recordId: id })).record, null);
  f.controller.social.setAccount('123');
  f.store.start({ id: 'private-focused-task', kind: 'dm', accountUid: '123', sessionId: f.store.get('binding').sessionId, now: f.now });
  f.store.update('private-focused-task', { state: 'failed', dmPayload: { secret: 'PRIVATE_TASK' } });
  assert.equal((await f.controller.status({ recordId: 'private-focused-task' })).record, null);
});
