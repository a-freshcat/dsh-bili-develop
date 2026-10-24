import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './fixtures.mjs';
import { Social } from '../src/social.mjs';
import { Store } from '../src/store.mjs';
import { Contacts } from '../src/contacts.mjs';
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

test('owner ordinary replies bypass evaluation and reply count caps, without consuming ordinary budget, while cooldown remains', async t => {
  const f = await setup(t, { owner: true, auto: true });
  f.controller.configure({ dmDailyReplyLimit: 0, dmPerPersonDailyLimit: 0, dmDailyEvaluationLimit: 0, activityStart: '00:00', activityEnd: '24:00' });
  for (let i = 0; i < 5; i++) {
    f.clock.now += 121000; f.messages[0] = { ...f.messages[0], id: 'owner-unlimited-' + i, at: f.clock.now };
    f.social.tick(); await f.social.job;
    assert.equal(f.sent.length, i + 1);
  }
  const budget = f.social.contacts.budget('123', '', f.store.config(), f.clock.now);
  assert.equal(budget.replies, 0); assert.equal(budget.evaluations, 0); assert.equal(budget.ownerReplies, 5); assert.equal(budget.ownerEvaluations, 5);
  f.messages[0] = { ...f.messages[0], id: 'owner-cooldown', at: f.clock.now }; await f.scan();
  const m = f.social.contacts.recent('123')[0]; await assert.rejects(f.social.send(m.id), { code: 'DM_INTERVAL' });
  assert.match(m.reason, /最短回复间隔/); assert.equal(f.sent.length, 5);
});

test('optional knowledge advice reaches private reply drafting but changing it cannot send an old draft', async t => {
  const f = await setup(t, { owner: true });
  f.controller.configure({ learningEnabled: true, learningKnowledgePacks: ['natural-short-zh'] }); await f.scan();
  assert.match(f.prompt(), /【可选知识包：自然中文短回复】/); assert.match(f.prompt(), /JSON外壳/);
  const m = f.social.contacts.recent('123')[0]; assert.equal(m.state, 'draft');
  f.controller.configure({ learningKnowledgePacks: [] }); await f.social.send(m.id);
  assert.equal(f.sent.length, 0); assert.equal(f.social.contacts.message(m.id).state, 'skipped');
  assert.match(f.social.contacts.message(m.id).reason, /知识包/);
});

test('automatic ordinary reply quota failure remains visible on draft and scan notice instead of being overwritten', async t => {
  const f = await setup(t, { auto: true }); f.controller.configure({ dmDailyReplyLimit: 0 }); await f.scan();
  const m = f.social.contacts.recent('123')[0]; assert.equal(m.state, 'draft'); assert.equal(f.sent.length, 0);
  assert.match(m.reason, /每日总/); assert.match(f.social.notice, /每日总/);
  await f.scan(); assert.match(f.social.notice, /每日总/); assert.equal(f.counters.prompt, 1);
});

test('owner inline Bilibili emote remains original evidence and reaches automatic reply even with zero ordinary quotas', async t => {
  for (const text of ['[doge]', '你好[千恋万花_害羞]', '😺']) {
    const f = await setup(t, { owner: true, auto: true, text, noReply: false });
    const originalPrompt = f.ctx.sessionController.prompt;
    f.ctx.sessionController.prompt = async request => {
      const source = request.content[0].text;
      const agent = f.sessions.get(request.sessionId), start = agent.events.length;
      await originalPrompt(request);
      for (const event of agent.events.slice(start)) if (event.type === 'assistant/message') event.data.message.content[0].text = JSON.stringify({
        runId: request.requestId, score_delta: 0, evaluation: '这是表达线索，不凭表情推断品格。', evidence_quote: text, should_reply: true, reply: '我看到你的表情啦。' });
      assert.ok(source.includes(text)); if (text.includes('[')) assert.match(source, /inlineEmotes/);
    };
    f.controller.configure({ dmDailyReplyLimit: 0, dmPerPersonDailyLimit: 0, dmDailyEvaluationLimit: 0 });
    await f.scan(); assert.equal(f.counters.prompt, 1); assert.equal(f.sent.length, 1);
    const m = f.social.contacts.recent('123')[0]; assert.equal(m.text, text); assert.equal(m.state, 'sent');
    assert.equal(f.social.contacts.person('123', '999').score, 5);
  }
});

test('owner quota migration preserves all attempts, excludes old ordinary owner replies once and never refunds other contacts on identity changes', async t => {
  const f = await setup(t, { owner: true, auto: true }); await f.scan();
  const config = f.store.config(), contacts = f.social.contacts;
  contacts.put('123', '456', { fan: true, score: 80 });
  contacts.reserveEvaluation({ id: 'quota-migrate-fan', uid: '456', accountUid: '123', state: 'draft', text: 'synthetic', draft: 'synthetic' }, config, f.clock.now);
  contacts.reserveSend(contacts.message('quota-migrate-fan'), config, f.clock.now);
  f.store.db.exec('DELETE FROM private_owner_quota'); f.store.set('privateOwnerQuotaV1', false);
  const migrated = new Contacts(f.store), b = migrated.budget('123', '', config, f.clock.now);
  assert.equal(b.replies, 1); assert.equal(b.ownerReplies, 1); assert.equal(b.evaluations, 1); assert.equal(b.ownerEvaluations, 1);
  assert.equal(f.store.db.prepare('SELECT COUNT(*) n FROM private_attempts').get().n, 2);
  f.controller.configure({ ownerAccountUid: '456' });
  assert.equal(new Contacts(f.store).budget('123', '', f.store.config(), f.clock.now).replies, 1);
  assert.equal(f.store.db.prepare('SELECT COUNT(*) n FROM private_owner_quota').get().n, 2);
});

test('exhausted ordinary evaluation quota does not starve an older owner message and disabled owner identity restores normal caps', async t => {
  const f = await setup(t, { owner: true, auto: true });
  f.controller.configure({ dmDailyReplyLimit: 0, dmPerPersonDailyLimit: 0, dmDailyEvaluationLimit: 0 });
  f.messages.unshift({ uid: '456', id: 'newest-ordinary-capped', text: '谢谢分享', at: f.clock.now + 2000 });
  await f.scan(); assert.equal(f.sent.length, 1); assert.equal(f.sent[0].uid, '999');
  f.controller.configure({ ownerAccountEnabled: false });
  f.clock.now += 121000; f.messages[1] = { ...f.messages[1], id: 'owner-disabled-new', at: f.clock.now };
  await f.scan(); assert.equal(f.sent.length, 1); assert.equal(f.counters.prompt, 1);
  assert.match(f.social.notice, /评价上限/);
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

test('automatic owner polling recovers a missing schedule after restart despite exhausted ordinary quotas', async t => {
  const f = await setup(t, { owner: true, auto: true });
  f.controller.configure({ dmDailyReplyLimit: 0, dmPerPersonDailyLimit: 0, dmDailyEvaluationLimit: 0, activityStart: '00:00', activityEnd: '24:00' });
  f.store.db.prepare('DELETE FROM kv WHERE key=?').run('dmNextPoll');
  f.clock.now += 61000; f.controller.social = new Social(f.controller);
  f.controller.social.tick(); await f.controller.social.job;
  assert.equal(f.sent.length, 1); assert.equal(f.counters.prompt, 1);
});

test('saving unrelated settings or enabling automatic sending does not postpone an already due inbox check', async t => {
  for (const change of [{ commentMaxChars: 170 }, { dmAutoSend: true }]) {
    const f = await setup(t, { owner: true, auto: false });
    f.controller.configure({ dmDailyReplyLimit: 0, dmPerPersonDailyLimit: 0, dmDailyEvaluationLimit: 0, activityStart: '00:00', activityEnd: '24:00' });
    f.clock.now += 61000; const due = f.store.get('dmNextPoll');
    f.controller.configure(change);
    assert.ok(f.store.get('dmNextPoll') <= f.clock.now, 'due check is not pushed into the future');
    f.social.tick(); await f.social.job; assert.equal(f.counters.prompt, 1);
    assert.equal(f.sent.length, change.dmAutoSend ? 1 : 0);
  }
});

test('a waiting browsing round between jobs does not suppress an automatic owner inbox check', async t => {
  const f = await setup(t, { owner: true, auto: true });
  f.controller.configure({ dmDailyReplyLimit: 0, dmDailyEvaluationLimit: 0, activityStart: '00:00', activityEnd: '24:00' });
  f.store.db.prepare('INSERT INTO rounds VALUES(?,?,?)').run('waiting-between-jobs', 'waiting', JSON.stringify({ id: 'waiting-between-jobs', state: 'waiting' }));
  f.clock.now += 61000; f.social.tick(); await f.social.job;
  assert.equal(f.sent.length, 1);
});

test('private schedule distinguishes activity, due, interval, busy and pause; optional all-day checking ignores browse hours', async t => {
  const f = await setup(t, { owner: true, auto: true });
  f.controller.configure({ activityStart: '08:00', activityEnd: '23:00', timeZone: 'Asia/Singapore', dmUseBrowseHours: true,
    dmDailyEvaluationLimit: 0, dmDailyReplyLimit: 0 });
  f.clock.now = Date.parse('2026-10-24T00:05:00+08:00'); f.store.set('dmNextPoll', f.clock.now - 1000);
  f.messages[0].at = f.clock.now; f.store.set('dmSince', f.clock.now - 1000);
  const old = f.social.schedule(); assert.equal(old.code, 'activity'); assert.match(old.nextCheckAt, /T00:00:00/);
  assert.equal(f.social.schedule().automaticReply, true); f.social.tick(); assert.equal(f.counters.prompt, 0);
  f.controller.configure({ dmUseBrowseHours: false }); assert.equal(f.social.schedule().code, 'due');
  f.social.start(); await f.social.job; f.social.close();
  assert.equal(f.sent.length, 1); assert.equal(f.social.schedule().code, 'interval'); assert.equal(f.social.schedule().lastCheckedAt, f.clock.now);
  f.clock.now += 61000; f.controller.metadataBusy = true; assert.equal(f.social.schedule().code, 'busy');
  f.social.tick(); assert.equal(f.sent.length, 1); f.controller.metadataBusy = false;
  f.social.pause(); assert.equal(f.social.schedule().code, 'paused'); assert.equal(f.social.schedule().nextCheckAt, null);
  f.social.resume(); assert.equal(f.social.schedule().code, 'due');
  f.controller.configure({ dmAutoSend: false }); assert.equal(f.social.schedule().automaticReply, false);
  f.controller.configure({ dmEnabled: false }); assert.equal(f.social.schedule().code, 'off');
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
