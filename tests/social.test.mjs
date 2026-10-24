import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './fixtures.mjs';
import { Social } from '../src/social.mjs';
import { Store } from '../src/store.mjs';
import { join } from 'node:path';

async function setup(t, options = {}) {
  const clock = { now: Date.parse('2026-10-23T12:00:00+08:00') };
  const messages = [{ uid: options.owner ? '999' : '456', id: 'message-key-1', text: options.text || '你好，谢谢分享，可以聊一聊吗？', at: clock.now + 1000 }];
  const sent = [], called = [];
  let lastPrompt = '';
  const f = fixture(t, { now: () => clock.now, neverIdle: options.neverIdle, output: (text, id) => {
    lastPrompt = text;
    if (options.badOutput) return 'not JSON';
    return JSON.stringify({ runId: id, score_delta: options.delta ?? 10, evaluation: '称呼礼貌且表达了感谢。',
      evidence_quote: '谢谢分享', should_reply: options.noReply ? false : true, reply: options.noReply ? '' : '你好，欢迎一起聊聊。', expression_feedback: options.feedback });
  }, call: async (method, params) => {
    called.push(method);
    if (method === 'dm_inbox') return { accountUid: '123', messages };
    if (method === 'dm_thread') {
      if (options.onThread) await options.onThread(f, params, called.filter(x => x === 'dm_thread').length);
      return { accountUid: options.accountChanged ? '888' : '123', uid: params.uid, fan: !options.stranger,
        blocked: !!options.blocked, message: options.stale ? null : messages.find(m => m.uid === params.uid) };
    }
    if (method === 'dm_reply') {
      sent.push(params);
      if (options.sendError) throw new Error('transport unknown');
      return { accountUid: '123', uid: params.uid, messageId: params.message_id, confirmed: !options.unconfirmed };
    }
    if (method === 'contacts_page') return { accountUid: '123', people: [{ uid: '456', name: '粉丝甲' }], hasMore: true };
    throw new Error('unexpected method: ' + method);
  } });
  await f.bind();
  f.controller.configure({ dmEnabled: true, dmAutoSend: !!options.auto, learningEnabled: !!options.learning,
    ...(options.owner ? { ownerAccountEnabled: true, ownerAccountUid: '999', ownerAccountName: '使用者', ownerAttitudeEnabled: true } : {}) });
  f.controller.social.setAccount('123');
  if (options.owner) f.controller.social.contacts.put('123', '999', { score: 5 });
  const scan = async () => { await f.controller.dispatch({ action: 'dm_scan' }); await f.controller.social.job; };
  return { ...f, clock, messages, sent, called, scan, prompt: () => lastPrompt, social: f.controller.social };
}

test('private dialogue contributes a deidentified reflection source even without an explicit criticism', async t => {
  const f = await setup(t, { learning: true, owner: true }); await f.scan();
  const status = f.controller.feedback.status();
  assert.ok(status.total >= 1, 'a processed private conversation must contribute a safe learning source');
  assert.equal(status.privateConversations, 1); assert.equal(status.privateFeedback, 0);
  const material = status.recent.find(r => r.scope === 'private_dialogue');
  assert.ok(material); assert.equal(material.quote, ''); assert.equal(material.url, '');
  assert.doesNotMatch(JSON.stringify(material), /谢谢分享|你好|使用者/); assert.equal(Object.hasOwn(material, 'uid'), false);
  await f.scan(); assert.equal(f.controller.feedback.status().privateConversations, 1);
  assert.equal(f.counters.prompt, 1); assert.equal(f.sent.length, 0);
});

test('semantic private feedback accepts a paraphrase outside the legacy phrases without another model turn', async t => {
  const f = await setup(t, { learning: true, text: '谢谢分享。不过你每次都像照着稿子念，能不能自然一点？',
    feedback: [{ code: 'less_formulaic', evidence_quote: '像照着稿子念' }] });
  await f.scan(); const status = f.controller.feedback.status();
  assert.ok(status.recent.some(r => r.code === 'less_formulaic'), 'a grounded semantic paraphrase must not depend on the old keyword list');
  assert.equal(status.privateConversations, 1); assert.equal(status.privateFeedback, 1);
  assert.ok(status.recent.some(r => r.code === 'less_formulaic'));
  assert.doesNotMatch(JSON.stringify(status.recent), /照着稿子念|谢谢分享/);
  assert.equal(f.counters.prompt, 1); assert.equal(f.sent.length, 0);
});

test('model failure does not discard the actual private conversation and explicit feedback already received', async t => {
  const f = await setup(t, { learning: true, badOutput: true, text: '人不是这样回答的' });
  await f.scan(); const status = f.controller.feedback.status();
  assert.ok(status.total >= 1, 'model failure must not discard already received feedback');
  assert.equal(status.privateConversations, 1); assert.equal(status.privateFeedback, 1);
  assert.equal(f.social.contacts.recent('123')[0].state, 'failed'); assert.equal(f.sent.length, 0);
});

test('optional feedback failure does not invalidate an otherwise private-safe reply or score update', async t => {
  const f = await setup(t, { learning: true });
  f.controller.configure({ privacyBlockedTerms: ['日终可比较'] });
  await f.scan(); assert.equal(f.social.contacts.recent('123')[0].state, 'draft');
  assert.equal(f.social.contacts.person('123', '456').score, 60);
  assert.equal(f.controller.feedback.status().total, 0); assert.match(f.controller.feedback.notice, /暂未保存/);
  assert.equal(f.sent.length, 0);
});

test('one incoming text gets an evidence-based score and private draft in the sole original conversation', async t => {
  const f = await setup(t); await f.scan();
  const m = f.social.contacts.recent('123')[0];
  assert.equal(m.state, 'draft'); assert.equal(f.social.contacts.person('123', '456').score, 60);
  assert.equal(f.sent.length, 0); assert.equal(f.counters.prompt, 1); assert.equal(f.counters.create, 1);
  const status = await f.controller.status();
  assert.equal(status.runs.length, 0); assert.equal(status.total, 0); assert.equal(status.social.messages.length, 1);
  assert.match(f.prompt(), /私信属于私人材料/);
  assert.equal(f.store.run(m.id).noteStatus, 'private');
  assert.equal(f.store.budget(f.store.config()).analyses, 0);
  const second = new Store(join(f.root, 'state.sqlite'));
  assert.equal(new Social({ ...f.controller, store: second }).contacts.person('123', '456').score, 60); second.close();
  await f.scan(); assert.equal(f.counters.prompt, 1); assert.equal(f.social.contacts.history('123', '456').length, 1);
});

test('automatic reply at60 is admitted once, scoped to sender and capped even after retry/restart', async t => {
  const f = await setup(t, { auto: true }); await f.scan();
  assert.equal(f.sent.length, 1); assert.equal(f.sent[0].uid, '456');
  const m = f.social.contacts.recent('123')[0]; assert.equal(m.state, 'sent');
  assert.equal(f.social.contacts.budget('123', '456', f.store.config(), f.clock.now).personReplies, 1);
  await f.scan(); assert.equal(f.sent.length, 1);
  await assert.rejects(f.social.send(m.id), { code: 'DM_RECORD' });
  assert.equal(f.counters.create, 1);
});

test('unknown accounts are never evaluated or replied to, owner low score is exempt', async t => {
  const stranger = await setup(t, { auto: true, stranger: true }); await stranger.scan();
  assert.equal(stranger.counters.prompt, 0); assert.equal(stranger.sent.length, 0);
  const owner = await setup(t, { auto: true, stranger: true, owner: true, delta: -5 }); await owner.scan();
  assert.equal(owner.sent.length, 1); assert.equal(owner.social.contacts.person('123', '999').score, 0);
  assert.match(owner.prompt(), /很生气/);
  assert.equal((await owner.controller.status()).social.people.some(p => p.uid === '999'), false);
});

test('rank101 can be evaluated but not replied to, score59 is not enough', async t => {
  const f = await setup(t, { auto: true });
  for (let i = 1; i <= 100; i++) f.social.contacts.put('123', String(i), { fan: true, score: 90 });
  await f.scan(); assert.equal(f.counters.prompt, 1); assert.equal(f.sent.length, 0);
  assert.equal(f.social.status().eligibleCount, 100);
  assert.match(f.social.contacts.recent('123')[0].reason, /前100名/);
  const low = await setup(t, { auto: true, delta: 9 }); await low.scan();
  assert.equal(low.sent.length, 0); assert.equal(low.social.contacts.person('123', '456').score, 59);
});

test('send rechecks rank, score, pause and fan status after async network preflight', async t => {
  for (const change of ['score', 'pause', 'rank']) {
    const f = await setup(t, { onThread: async (f, _p, count) => {
      if (count !== 2) return;
      if (change === 'score') f.controller.social.contacts.put('123', '456', { score: 59 });
      if (change === 'pause') f.controller.social.pause();
      if (change === 'rank') for (let i = 1; i <= 100; i++) f.controller.social.contacts.put('123', String(i), { fan: true, score: 99 });
    } });
    await f.scan();
    await assert.rejects(f.social.send(f.social.contacts.recent('123')[0].id));
    assert.equal(f.sent.length, 0, change);
  }
});

test('daily total, per-person caps and minimum spacing also apply to owner', async t => {
  const f = await setup(t, { owner: true }); await f.scan(); const id = f.social.contacts.recent('123')[0].id;
  f.controller.configure({ dmDailyReplyLimit: 0 });
  await assert.rejects(f.social.send(id), { code: 'DM_LIMIT' }); assert.equal(f.sent.length, 0);
  f.controller.configure({ dmDailyReplyLimit: 2, dmPerPersonDailyLimit: 1 });
  await f.social.send(id); assert.equal(f.sent.length, 1);
  f.messages[0] = { ...f.messages[0], id: 'message-key-2' }; await f.scan();
  await assert.rejects(f.social.send(f.social.contacts.recent('123')[0].id), { code: 'DM_LIMIT' });
  f.controller.configure({ dmPerPersonDailyLimit: 2 });
  await assert.rejects(f.social.send(f.social.contacts.recent('123')[0].id), { code: 'DM_INTERVAL' });
  f.clock.now += 121000; await f.social.send(f.social.contacts.recent('123')[0].id); assert.equal(f.sent.length, 2);
});

test('uncertain send consumes quota and is never automatically or manually retried', async t => {
  const f = await setup(t, { auto: true, sendError: true }); await f.scan();
  const m = f.social.contacts.recent('123')[0]; assert.equal(m.state, 'unknown');
  assert.equal(f.social.contacts.budget('123', '456', f.store.config(), f.clock.now).replies, 1);
  await f.scan(); await assert.rejects(f.social.send(m.id)); assert.equal(f.sent.length, 1);
  f.social.contacts.saveMessage({ ...m, state: 'sending' });
  const recovered = new Social(f.controller); assert.equal(recovered.contacts.message(m.id).state, 'unknown');
});

test('pause survives restart, old messages and malformed model output do not trigger sends', async t => {
  const f = await setup(t); f.social.pause();
  const recovered = new Social(f.controller); assert.equal(recovered.paused, true);
  await assert.rejects(f.scan(), { code: 'DM_DISABLED' });
  f.social.resume(); f.messages[0].at = f.clock.now - 1000; await f.scan(); assert.equal(f.counters.prompt, 0);
  const bad = await setup(t, { auto: true, badOutput: true }); await bad.scan();
  assert.equal(bad.sent.length, 0); assert.equal(bad.social.contacts.recent('123')[0].state, 'failed');
});

test('account switch and replaced message block sends; imports keep ratings and isolate accounts', async t => {
  const f = await setup(t); await f.scan();
  f.social.contacts.put('123', '456', { score: 88 });
  f.social.importFans(1); await f.social.job;
  assert.equal(f.social.contacts.person('123', '456').score, 88); assert.equal(f.social.status().importPage, 2);
  const id = f.social.contacts.recent('123')[0].id;
  f.messages[0] = { ...f.messages[0], id: 'newer-message' }; await f.social.send(id);
  assert.equal(f.sent.length, 0); assert.equal(f.social.contacts.message(id).state, 'skipped');
  f.social.setAccount('888'); assert.equal(f.social.status().people.length, 0);
  const switched = await setup(t, { accountChanged: true }); await switched.scan(); assert.equal(switched.counters.prompt, 0);
});

test('clearing private content preserves dedup, scores and attempt quotas while removing local private copies', async t => {
  const f = await setup(t, { auto: true }); await f.scan();
  const m = f.social.contacts.recent('123')[0];
  const score = f.social.contacts.person('123', '456').score;
  f.social.forget(m.id);
  assert.equal(f.social.contacts.recent('123').length, 0);
  assert.equal(f.social.contacts.message(m.id).state, 'redacted');
  assert.equal(f.social.contacts.message(m.id).text, '');
  assert.equal(f.social.contacts.person('123', '456').quote, '');
  assert.equal(f.social.contacts.person('123', '456').score, score);
  assert.equal(f.store.run(m.id), null);
  assert.equal(f.social.contacts.history('123', '456').length, 0);
  assert.equal(f.social.contacts.budget('123', '456', f.store.config(), f.clock.now).replies, 1);
  await f.scan(); assert.equal(f.sent.length, 1); assert.equal(f.counters.prompt, 1);
});

test('evaluation budget is durable, zero disables calls and timezone changes do not reset it', async t => {
  const f = await setup(t); f.controller.configure({ dmDailyEvaluationLimit: 0 }); await f.scan();
  assert.equal(f.counters.prompt, 0);
  f.controller.configure({ dmDailyEvaluationLimit: 1 }); await f.scan(); assert.equal(f.counters.prompt, 1);
  const before = f.social.contacts.budget('123', '456', f.store.config(), f.clock.now);
  f.controller.configure({ timeZone: 'America/Los_Angeles' });
  f.messages[0] = { ...f.messages[0], id: 'message-key-2' }; await f.scan();
  assert.equal(f.counters.prompt, 1);
  assert.equal(f.social.contacts.budget('123', '456', f.store.config(), f.clock.now).end, before.end);
  f.clock.now = before.end + 1000; f.messages[0].at = f.clock.now; await f.scan(); assert.equal(f.counters.prompt, 2);
});

test('automatic checks respect enable, due time and activity; paused browsing does not pause DM', async t => {
  const f = await setup(t); f.controller.configure({ activityStart: '00:00', activityEnd: '23:59' });
  f.clock.now += 61000; f.controller.social.tick(); await f.social.job;
  assert.equal(f.counters.prompt, 1);
  f.messages[0] = { ...f.messages[0], id: 'message-key-2', at: f.clock.now }; f.controller.social.tick();
  assert.equal(f.counters.prompt, 1);
  f.store.set('dmNextPoll', f.clock.now); f.social.pause(); f.social.tick(); assert.equal(f.social.busy, false);
  f.social.resume(); f.store.set('browsingPaused', true); f.social.tick(); await f.social.job; assert.equal(f.counters.prompt, 2);
  f.controller.configure({ dmEnabled: false }); f.clock.now += 61000; f.social.tick(); assert.equal(f.social.busy, false);
});

test('changing persona, owner attitude or re-enabling later invalidates an older private draft', async t => {
  for (const change of ['persona', 'attitude', 're-enable']) {
    const f = await setup(t); await f.scan(); const id = f.social.contacts.recent('123')[0].id;
    if (change === 'persona') f.controller.configure({ persona: '新的固定人设' });
    if (change === 'attitude') f.controller.configure({ ownerAttitudeEnabled: true });
    if (change === 're-enable') {
      f.controller.configure({ dmEnabled: false }); f.clock.now += 10000; f.controller.configure({ dmEnabled: true });
    }
    await f.social.send(id); assert.equal(f.sent.length, 0); assert.equal(f.social.contacts.message(id).state, 'skipped');
  }
});

test('restart reconciles a durable private model result once without another prompt or duplicate score delta', async t => {
  const f = await setup(t, { neverIdle: true }); await f.scan();
  const id = f.social.contacts.recent('123')[0].id;
  assert.equal(f.store.run(id).state, 'awaiting_model');
  assert.equal(f.social.contacts.person('123', '456').score, 50);
  f.controller.social = new Social(f.controller);
  await f.controller.recover(); await f.controller.reconcile(id);
  assert.equal(f.controller.social.contacts.person('123', '456').score, 60);
  assert.equal(f.controller.social.contacts.history('123', '456').length, 1);
  assert.equal(f.counters.prompt, 1); assert.equal(f.counters.create, 1); assert.equal(f.sent.length, 0);
});

test('unloading before a queued contact job starts performs no new network or model calls', async t => {
  const f = await setup(t);
  f.social.importFans(1); f.controller.close(); await f.social.job;
  assert.equal(f.called.length, 0); assert.equal(f.counters.prompt, 0);
});
