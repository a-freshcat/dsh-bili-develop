import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './fixtures.mjs';
import { Relationships } from '../src/relationships.mjs';

async function setup(t, o = {}) {
  const clock = { now: Date.parse('2026-10-24T12:00:00+08:00') }, calls = [];
  let version = 'a'.repeat(64); const followed = new Set();
  const f = fixture(t, { now: () => clock.now, aborted: o.aborted, output: (_text, id) => JSON.stringify({ runId: id, should_send: true, reply: '今天有空的话，一起聊聊最近的新发现吧。', reason: '简短问候，不强求回复。' }),
    call: async (method, params) => {
      calls.push({ method, params });
      if (o.onCall) await o.onCall(f, method, params);
      const found = { accountUid: o.accountChanged ? '999' : '123', uid: params.uid, following: !!o.following || followed.has(params.uid), fan: !o.notFan, blocked: !!o.blocked,
        threadVersion: version, latestAt: o.recent ? clock.now - 1000 : 0 };
      if (['relationship_probe', 'dm_proactive_probe'].includes(method)) return found;
      if (o.unknown) throw new Error('transport unknown');
      if (method === 'follow_user') { followed.add(params.uid); return { ...found, confirmed: true, attempted: true }; }
      if (method === 'dm_proactive_send') return { ...found, confirmed: true };
      throw new Error('Unexpected method ' + method);
    } });
  await f.bind(); f.controller.social.setAccount('123');
  const r = f.controller.relationships, contacts = r.contacts;
  const put = (uid = '456', score = 100) => contacts.put('123', uid, { fan: true, score }); put();
  return { ...f, clock, calls, r, contacts, put, version: v => { version = v; } };
}

test('relationship defaults perform zero operations and zero proactive limit creates no model request', async t => {
  const f = await setup(t); await f.r.process(); assert.equal(f.calls.length, 0); assert.equal(f.counters.prompt, 0);
  f.controller.configure({ dmProactiveEnabled: true, dmProactiveDailyLimit: 0 }); await f.r.process();
  assert.equal(f.calls.length, 0); assert.equal(f.counters.prompt, 0);
});

test('80 threshold, already-followed exclusion, daily cap, cooldown and unknown follow never retry', async t => {
  const f = await setup(t); f.controller.configure({ autoFollowEnabled: true });
  await assert.rejects(f.r.follow(f.put('456', 79)), { code: 'RELATION_SCORE' }); assert.equal(f.calls.length, 0);
  await f.r.follow(f.put('456', 80)); assert.equal(f.r.budget().follows, 1);
  await f.r.follow(f.put('456', 90)); assert.equal(f.calls.filter(c => c.method === 'follow_user').length, 1);
  await assert.rejects(f.r.follow(f.put('457', 80)), { code: 'FOLLOW_LIMIT' });
  f.clock.now += 3600000; f.controller.configure({ autoFollowDailyLimit: 1 });
  await assert.rejects(f.r.follow(f.contacts.person('123', '457')), { code: 'FOLLOW_LIMIT' });
  const already = await setup(t, { following: true }); already.controller.configure({ autoFollowEnabled: true });
  await already.r.follow(already.put('456', 80)); assert.equal(already.r.budget().follows, 0); assert.equal(already.calls.length, 1);
  const unknown = await setup(t, { unknown: true }); unknown.controller.configure({ autoFollowEnabled: true });
  await unknown.r.follow(unknown.put('456', 80)); new Relationships(unknown.controller); await unknown.r.follow(unknown.put('456', 80));
  assert.equal(unknown.calls.filter(c => c.method === 'follow_user').length, 1); assert.equal(unknown.r.budget().follows, 1);
});

test('follow rechecks score, account and current platform fan/block status before reserving mutation', async t => {
  for (const o of [{ blocked: true }, { notFan: true }, { accountChanged: true }, { onCall(f) { f.controller.social.contacts.put('123', '456', { score: 79 }); } }]) {
    const f = await setup(t, o); f.controller.configure({ autoFollowEnabled: true });
    await assert.rejects(f.r.follow(f.contacts.person('123', '456'))); assert.equal(f.calls.filter(c => c.method === 'follow_user').length, 0); assert.equal(f.r.budget().follows, 0);
  }
});

test('100 proactive message is a genuine independent private task, once daily, sharing totals, never changing score', async t => {
  const f = await setup(t); f.controller.configure({ dmProactiveEnabled: true }); assert.equal(f.store.config().dmEnabled, false);
  const session = f.store.get('binding').sessionId;
  await f.r.prepareProactive(f.contacts.person('123', '456')); await f.controller.idle();
  const m = f.contacts.recent('123')[0], run = f.store.run(m.id);
  assert.equal(m.kind, 'proactive'); assert.equal(m.state, 'sent'); assert.equal(run.kind, 'dm_proactive'); assert.equal(run.sessionId, session);
  assert.equal(f.contacts.person('123', '456').score, 100); assert.equal(f.r.budget().proactive, 1); assert.equal(f.r.budget().proactiveGenerations, 1);
  assert.equal(f.controller.social.status().budget.replies, 1); assert.equal(f.counters.prompt, 1); assert.equal(f.counters.create, 1);
  assert.equal(f.store.count(), 0); assert.equal(f.store.budget(f.store.config()).analyses, 0);
  await f.r.prepareProactive(f.contacts.person('123', '456')); assert.equal(f.counters.prompt, 1);
  await assert.rejects(f.r.send(m.id)); assert.equal(f.calls.filter(c => c.method === 'dm_proactive_send').length, 1);
});

test('100 requirement, top100, shared reply/evaluation limits and recent interaction all prevent proactive generation', async t => {
  for (const config of [{ dmDailyReplyLimit: 0 }, { dmPerPersonDailyLimit: 0 }, { dmDailyEvaluationLimit: 0 }]) {
    const f = await setup(t); f.controller.configure({ dmProactiveEnabled: true, ...config });
    await assert.rejects(f.r.prepareProactive(f.contacts.person('123', '456')), { code: 'PROACTIVE_LIMIT' }); assert.equal(f.counters.prompt, 0);
  }
  const f = await setup(t); f.controller.configure({ dmProactiveEnabled: true });
  await assert.rejects(f.r.prepareProactive(f.put('456', 99)), { code: 'RELATION_SCORE' }); f.put();
  for (let i = 1; i <= 100; i++) f.put(String(i), 100);
  await assert.rejects(f.r.prepareProactive(f.contacts.person('123', '456')), { code: 'RELATION_SCORE' });
  const recent = await setup(t, { recent: true }); recent.controller.configure({ dmProactiveEnabled: true });
  await recent.r.prepareProactive(recent.contacts.person('123', '456')); assert.equal(recent.counters.prompt, 0);
});

test('private context blocks cross-recipient automatic proactive sends, manual consent is bound and no score bypass exists', async t => {
  const f = await setup(t); f.controller.configure({ dmProactiveEnabled: true });
  f.controller.privacy.remember('other-private', f.store.get('binding').sessionId, '123', '999', ['合成的另一位联系人的私密交流内容']);
  await assert.rejects(f.r.prepareProactive(f.contacts.person('123', '456')), { code: 'PRIVACY_AUTO_BLOCKED' });
  const m = f.contacts.recent('123')[0]; assert.equal(m.state, 'draft'); assert.equal(f.r.budget().proactive, 0);
  f.controller.privacy.review('dm:' + m.id, m.draft, { privacyReviewed: true, privacyContext: f.controller.privacy.context().contextHash }, true);
  await f.r.send(m.id); assert.equal(f.contacts.message(m.id).state, 'sent');
});

test('changed thread, disabled switch, changed score, next day and policy invalidate old greetings before an attempt', async t => {
  for (const change of ['thread', 'off', 'score', 'day', 'policy']) {
    const f = await setup(t); f.controller.configure({ dmProactiveEnabled: true });
    f.controller.privacy.remember('other-private', f.store.get('binding').sessionId, '123', '999', ['仅供回归测试的其他私聊内容']);
    await assert.rejects(f.r.prepareProactive(f.contacts.person('123', '456')));
    const m = f.contacts.recent('123')[0];
    f.controller.privacy.review('dm:' + m.id, m.draft, { privacyReviewed: true, privacyContext: f.controller.privacy.context().contextHash }, true);
    if (change === 'thread') f.version('b'.repeat(64));
    if (change === 'off') f.controller.configure({ dmProactiveEnabled: false });
    if (change === 'score') f.put('456', 99);
    if (change === 'day') f.clock.now += 86400000;
    if (change === 'policy') f.controller.configure({ persona: '新的基础人设。' });
    await assert.rejects(f.r.send(m.id)); assert.equal(f.r.budget().proactive, 0); assert.equal(f.calls.filter(c => c.method === 'dm_proactive_send').length, 0);
  }
});

test('uncertain proactive send reserves total and stays unknown on restart without retry; aborted generation releases queue', async t => {
  const f = await setup(t, { unknown: true }); f.controller.configure({ dmProactiveEnabled: true });
  await f.r.prepareProactive(f.contacts.person('123', '456')); const m = f.contacts.recent('123')[0];
  assert.equal(m.state, 'unknown'); new Relationships(f.controller); await f.r.prepareProactive(f.contacts.person('123', '456'));
  assert.equal(f.calls.filter(c => c.method === 'dm_proactive_send').length, 1); assert.equal(f.r.budget().proactive, 1);
  const aborted = await setup(t, { aborted: true }); aborted.controller.configure({ dmProactiveEnabled: true });
  await aborted.r.prepareProactive(aborted.contacts.person('123', '456')); assert.equal(aborted.contacts.recent('123')[0].state, 'failed'); assert.equal(aborted.store.active(), null);
});
