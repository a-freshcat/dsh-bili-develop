import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './fixtures.mjs';

async function setup(t) {
  const f = fixture(t); await f.bind(); f.controller.configure({ ownerAccountEnabled: true, ownerAccountUid: '789', ownerAccountName: '测试使用者' });
  f.controller.social.setAccount('123'); const contacts = f.controller.social.contacts;
  const put = (uid, n, state = 'sent', accountUid = '123') => contacts.saveMessage({
    id: 'synthetic-' + accountUid + '-' + uid + '-' + n, uid, accountUid, state, at: 100000 + n,
    text: '来信-' + accountUid + '-' + uid + '-' + n, draft: '回复-' + uid + '-' + n, evaluation: '仅测试', kind: 'reply' });
  for (let n = 0; n < 27; n++) put('789', n, n === 26 ? 'draft' : 'sent');
  for (let n = 0; n < 23; n++) { const uid = String(1000 + n); contacts.put('123', uid, { name: '测试联系人' + n, fan: true }); put(uid, n); }
  put('789', 99, 'redacted'); put('789', 100, 'sent', '999');
  return { ...f, contacts, put };
}

test('private inbox groups all local records by recipient, pins owner and returns only ten selected-person messages', async t => {
  const f = await setup(t), s = f.controller.social.status();
  assert.equal(s.conversations.owner.uid, '789'); assert.equal(s.conversations.owner.total, 27); assert.equal(s.conversations.owner.drafts, 1);
  assert.equal(s.conversations.people.length, 20); assert.equal(s.conversations.total, 23);
  assert.equal(s.messages.length, 10); assert.ok(s.messages.every(m => m.uid === '789' && m.isOwner));
  assert.equal(s.messages[0].text, '来信-123-789-26'); assert.ok(!JSON.stringify(s).includes('来信-999'));
  assert.equal(f.counters.read, 0); assert.equal(f.counters.prompt, 0);
});

test('recipient and message pages access older saved history, search contacts and retain explicit selection', async t => {
  const f = await setup(t);
  const s = await f.controller.status({ privateView: { uid: '789', offset: 20, peopleOffset: 20, account: '123' } });
  assert.equal(s.social.messages.length, 7); assert.equal(s.social.messages[0].text, '来信-123-789-6');
  assert.equal(s.social.conversations.people.length, 3);
  const filtered = f.controller.social.status({ privateView: { q: '测试联系人22', uid: '1022' } });
  assert.equal(filtered.conversations.people.length, 1); assert.equal(filtered.conversations.owner.uid, '789');
  assert.ok(filtered.messages.every(m => m.uid === '1022' && !m.isOwner));
  assert.equal(f.controller.social.status({ privateView: filtered.privateView }).privateView.uid, '1022');
});

test('cleared last page clamps to valid history; account switching resets stale selection and returns no foreign raw text', async t => {
  const f = await setup(t);
  for (let n = 0; n < 7; n++) { const m = f.contacts.message('synthetic-123-789-' + n); f.contacts.saveMessage({ ...m, state: 'redacted', text: '', draft: '' }); }
  const s = f.controller.social.status({ privateView: { uid: '789', offset: 20, account: '123' } });
  assert.equal(s.privateView.offset, 10); assert.equal(s.messages.length, 10);
  f.controller.social.setAccount('999');
  const switched = f.controller.social.status({ privateView: { uid: '1022', offset: 20, peopleOffset: 20, q: '旧查询', account: '123' } });
  assert.equal(switched.privateView.account, '999'); assert.equal(switched.privateView.uid, '789'); assert.equal(switched.privateView.q, '');
  assert.equal(switched.messages.length, 1); assert.equal(switched.messages[0].text, '来信-999-789-100');
  assert.ok(!JSON.stringify(switched).includes('来信-123'));
});

test('invalid private selectors fail before reading any content', async t => {
  const f = await setup(t);
  for (const privateView of [null, [], { uid: 'not-a-uid' }, { offset: -1 }, { offset: 1.2 }, { peopleOffset: 1000001 }, { q: 'a\n' }, { arbitrary: true }]) {
    assert.throws(() => f.controller.social.status({ privateView }));
  }
  assert.equal(f.counters.prompt, 0); assert.equal(f.counters.read, 0);
});
