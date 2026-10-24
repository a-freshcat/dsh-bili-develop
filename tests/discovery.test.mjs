import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fixture, preview } from './fixtures.mjs';
import { Store, DEFAULT_CONFIG } from '../src/store.mjs';
import { Controller } from '../src/controller.mjs';
import { configOf } from '../src/decision.mjs';
const A = 'BV1000000000', B = 'BV2000000000', C = 'BV3000000000';
const flush = () => new Promise(resolve => setImmediate(resolve));
async function setup(t, options = {}) {
  const clock = { value: Date.parse('2026-10-24T04:00:00Z') }, prompts = [], calls = { feed: 0, read: [] };
  const f = fixture(t, { now: () => clock.value, noResult: options.noResult, output(text, id) {
    prompts.push(text);
    if (text.includes('现在自主挑选')) return JSON.stringify(options.choice?.(id) || { runId: id, intent: '想看看有实际制作过程的内容。', choices: [{ bvid: B, reason: '实际标签是手工制作，想了解它的制作过程。' }] });
    return JSON.stringify(preview(id));
  } }); await f.bind();
  f.controller.configure({ browseMode: 'autonomous', keywords: [], dailyBrowseChoiceLimit: 3, videosPerRound: 1,
    timeZone: 'Asia/Singapore', ...options.config });
  const reader = { async call(method, params) {
    if (method === 'account') return { status: 'logged_in', uid: options.account?.() || '123' };
    if (method === 'recommend_videos') {
      calls.feed++; if (options.feed) return options.feed();
      return { source: 'recommendation', accountUid: '123', checkedAt: new Date(clock.value).toISOString(), videos: [A, B, C].map((bvid, n) => ({ bvid, title: ['标题里没有兴趣词', '普通的记录', '新的音乐'][n],
        description: '实际简介：展示制作过程。', owner: { uid: '987', name: '公开作者' }, duration: 30, tags: [{ id: '1', name: n === 1 ? '手工制作' : '音乐' }] })) };
    }
    if (method === 'read_video') { calls.read.push(params.bvid); return { ...f.evidence, bvid: params.bvid, accountUid: options.readAccount || '123' }; }
    throw new Error('Unexpected reader method: ' + method);
  } };
  f.controller.reader = () => reader;
  return { ...f, clock, prompts, calls, reader };
}
async function pump(f, steps = 7) { for (let n = 0; n < steps; n++) { await flush(); await f.controller.scheduler.tick(); await f.controller.idle(); } await flush(); }

test('autonomous recommendations need no keywords: persona and actual tags choose a supplied video once, in the same dialogue', async t => {
  const f = await setup(t, { config: { learningEnabled: true, persona: '我是好奇的手工爱好者。' } });
  f.store.set('iteration:123', { version: 4, traits: [{ id: 'trait-a', text: '想了解有完整制作过程的手艺。', reason: '先前比较保留', sourceIds: [] }] });
  const beforeConfig = f.store.config(), beforeCursor = f.store.get('keywordCursor');
  await f.controller.scheduler.runNow('autonomous-positive-round'); await pump(f);
  const round = f.store.round('autonomous-positive-round');
  assert.equal(round.state, 'completed'); assert.equal(f.calls.feed, 1); assert.deepEqual(f.calls.read, [B]);
  assert.equal(f.counters.prompt, 2); assert.equal(f.counters.create, 1); assert.equal(round.selection.chosen[0].bvid, B);
  assert.match(f.prompts[0], /手工爱好者/); assert.match(f.prompts[0], /完整制作过程的手艺/); assert.match(f.prompts[0], /实际简介/);
  assert.match(f.prompts[0], /不要从旧对话的私信/); assert.equal(f.store.get('keywordCursor'), beforeCursor);
  assert.equal(f.controller.discovery.budget().calls, 1); assert.equal(f.controller.scheduler.status().budget.analyses, 1);
  const run = f.store.run(round.analysisIds[0]); assert.equal(run.browseSelection.mode, 'autonomous');
  assert.match(readFileSync(join(f.workspacePath, run.notePath), 'utf8'), /自主选片入口/);
  assert.deepEqual(f.store.config(), beforeConfig);
  await f.controller.scheduler.runNow(round.id); await pump(f, 2); assert.equal(f.calls.feed, 1); assert.equal(f.counters.prompt, 2);
});

test('choosing nothing and a batch containing only previously seen videos both finish without video analysis', async t => {
  const f = await setup(t, { choice: id => ({ runId: id, intent: '这批都不想看，等下一批。', choices: [] }) });
  await f.controller.scheduler.runNow('autonomous-empty-choice'); await pump(f);
  assert.equal(f.counters.prompt, 1); assert.equal(f.calls.read.length, 0); assert.equal(f.store.openRound(), null);
  for (const bvid of [A, B, C]) f.store.markSeen('123', bvid);
  await f.controller.scheduler.runNow('autonomous-all-seen-feed'); await pump(f);
  assert.equal(f.counters.prompt, 1); assert.equal(f.controller.discovery.budget().calls, 1);
  assert.match(f.store.round('autonomous-all-seen-feed').reason, /没有资料完整且未浏览/);
});

test('forged or repeated BV choices and too many choices cannot start a video or refund the choice attempt', async t => {
  for (const [name, choices] of [['forged', [{ bvid: 'BV9000000000', reason: '编造' }]], ['duplicate', [{ bvid: A, reason: '重复1' }, { bvid: A, reason: '重复2' }]],
    ['excess', [{ bvid: A, reason: '1' }, { bvid: B, reason: '2' }, { bvid: C, reason: '3' }]]]) {
    await t.test(name, async st => {
      const f = await setup(st, { config: { videosPerRound: 2 }, choice: id => ({ runId: id, intent: '试试看', choices }) });
      await f.controller.scheduler.runNow('autonomous-bad-' + name); await pump(f);
      assert.equal(f.calls.read.length, 0); assert.equal(f.counters.prompt, 1); assert.equal(f.controller.discovery.budget().calls, 1);
      assert.equal(f.store.round('autonomous-bad-' + name).state, 'failed');
      await pump(f, 3); assert.equal(f.counters.prompt, 1);
    });
  }
});

test('daily choice zero and exhaustion stop new rounds without consuming video or round allowance', async t => {
  const f = await setup(t, { config: { dailyBrowseChoiceLimit: 0 } });
  await assert.rejects(f.controller.scheduler.runNow('autonomous-zero-limit'), { code: 'DISCOVERY_LIMIT' });
  assert.equal(f.controller.scheduler.status().budget.rounds, 0); assert.equal(f.calls.feed, 0);
  f.controller.configure({ dailyBrowseChoiceLimit: 1, autoEnabled: true });
  await pump(f); const rounds = f.controller.scheduler.status().budget.rounds;
  f.clock.value += 2 * 3600000; await pump(f);
  assert.equal(f.controller.scheduler.status().budget.rounds, rounds); assert.equal(f.calls.feed, 1);
  assert.match(f.controller.scheduler.status().schedule.message, /自主选片调用已达/);
  await assert.rejects(f.controller.scheduler.runNow('autonomous-exhausted'), { code: 'DISCOVERY_LIMIT' });
  const before = f.controller.discovery.budget().calls; f.controller.configure({ timeZone: 'America/New_York' });
  assert.equal(f.controller.discovery.budget().calls, before);
});

test('pause during recommendation stores the batch but admits no model, then resumes it without fetching again', async t => {
  let release, started; const began = new Promise(resolve => { started = resolve; });
  const f = await setup(t); const original = f.reader.call.bind(f.reader);
  f.reader.call = async (method, params) => {
    if (method !== 'recommend_videos') return original(method, params);
    started(); await new Promise(resolve => { release = resolve; }); return original(method, params);
  };
  await f.controller.scheduler.runNow('autonomous-pause-feed'); await began;
  f.controller.scheduler.pause(); release(); await pump(f, 2);
  assert.equal(f.counters.prompt, 0); assert.equal(f.store.openRound().state, 'paused');
  f.controller.scheduler.resume(); await pump(f);
  assert.equal(f.calls.feed, 1); assert.equal(f.counters.prompt, 2); assert.deepEqual(f.calls.read, [B]);
});

test('a durable original choice is recovered after reopen without another feed, prompt, or choice charge', async t => {
  const f = await setup(t); await f.controller.scheduler.runNow('autonomous-reopen-choice'); await flush(); await f.controller.idle();
  const round = f.store.openRound(); assert.ok(round.candidates?.length); f.controller.scheduler.pause();
  f.controller.close(); f.store.close(); f.store.close = () => {};
  const reopened = new Store(join(f.root, 'state.sqlite')); f.host.store = reopened;
  const c = new Controller({ store: reopened, host: f.host, reader: () => f.reader, now: () => f.clock.value });
  try {
    assert.equal(c.scheduler.paused, true); c.scheduler.resume(); await pump({ controller: c });
    assert.equal(f.calls.feed, 1); assert.equal(f.counters.prompt, 2); assert.equal(c.discovery.budget().calls, 1);
    assert.deepEqual(f.calls.read, [B]); assert.equal(reopened.get('binding').sessionId, round.sessionId);
  } finally { c.close(); reopened.close(); }
});

test('unknown original model completion remains one request, and valid later output is reconciled rather than resent', async t => {
  const f = await setup(t, { noResult: true }); await f.controller.scheduler.runNow('autonomous-unknown-choice'); await pump(f, 2);
  const round = f.store.openRound(), run = f.store.run(round.choiceId); assert.equal(run.state, 'awaiting_model');
  await pump(f, 3); assert.equal(f.counters.prompt, 1); assert.equal(f.calls.feed, 1); assert.equal(f.calls.read.length, 0);
  const events = f.sessions.get(run.sessionId).events;
  events.push({ seq: 1, type: 'user/message', data: { turn: 3, source: { rpcId: run.id } } },
    { seq: 2, type: 'assistant/message', data: { message: { content: [{ type: 'text', text: JSON.stringify({ runId: run.id, intent: '想了解手工', choices: [{ bvid: B, reason: '标签是手工制作' }] }) }] } } },
    { seq: 3, type: 'turn/end', data: { turn: 3, reason: { kind: 'completed' } } });
  await f.controller.reconcile(run.id); assert.equal(f.store.run(run.id).state, 'completed');
  assert.equal(f.counters.prompt, 1); assert.equal(f.controller.discovery.budget().calls, 1);
});

test('account changes across feed or content reads never leak another account into selection or evaluation', async t => {
  let uid = '123'; const f = await setup(t, { account: () => uid });
  const original = f.reader.call.bind(f.reader); f.reader.call = async (method, params) => { const v = await original(method, params); if (method === 'recommend_videos') uid = '999'; return v; };
  await f.controller.scheduler.runNow('autonomous-account-change'); await pump(f);
  assert.equal(f.counters.prompt, 0); assert.equal(f.calls.read.length, 0);
  const g = await setup(t, { readAccount: '999' }); await g.controller.scheduler.runNow('autonomous-read-account'); await pump(g);
  assert.equal(g.counters.prompt, 1); assert.equal(g.store.run(g.store.round('autonomous-read-account').analysisIds[0]).state, 'failed');
});

test('persona changes and deadline expiration stop remaining autonomous videos without selecting again', async t => {
  const f = await setup(t); await f.controller.scheduler.runNow('autonomous-persona-change'); await flush(); await f.controller.idle();
  f.controller.configure({ persona: '我现在只想看看烹饪内容。' }); await pump(f);
  assert.equal(f.calls.read.length, 0); assert.equal(f.counters.prompt, 1); assert.equal(f.store.openRound(), null);
  const g = await setup(t); await g.controller.scheduler.runNow('autonomous-deadline'); await flush(); await g.controller.idle();
  g.clock.value += 20 * 60000; await pump(g);
  assert.equal(g.calls.read.length, 0); assert.equal(g.counters.prompt, 1);
});

test('autonomous mode can ignore retained keyword/TAG settings but search mode still requires its configured source', () => {
  const base = { ...DEFAULT_CONFIG, browseMode: 'autonomous', autoEnabled: true, keywords: [], browseTagEnabled: true, browseTags: [] };
  assert.equal(configOf(base, DEFAULT_CONFIG).browseMode, 'autonomous');
  assert.throws(() => configOf({ ...base, browseMode: 'search' }, DEFAULT_CONFIG));
  for (const patch of [{ browseMode: 'unbounded' }, { dailyBrowseChoiceLimit: -1 }, { dailyBrowseChoiceLimit: 51 }]) assert.throws(() => configOf(patch, DEFAULT_CONFIG));
});

test('stale/forged recommendation metadata cannot reach the model, and shutdown during feed admission starts nothing', async t => {
  const f = await setup(t); const original = f.reader.call.bind(f.reader);
  f.reader.call = async (method, params) => { const v = await original(method, params); return method === 'recommend_videos' ? { ...v, accountUid: '999' } : v; };
  await f.controller.scheduler.runNow('autonomous-forged-feed'); await pump(f);
  assert.equal(f.counters.prompt, 0); assert.equal(f.calls.read.length, 0);
  const g = await setup(t); const normal = g.reader.call.bind(g.reader);
  g.reader.call = async (method, params) => { const v = await normal(method, params); if (method === 'recommend_videos') g.controller.close(); return v; };
  await g.controller.scheduler.runNow('autonomous-close-feed'); await pump(g, 2);
  assert.equal(g.counters.prompt, 0); assert.equal(g.controller.discovery.budget().calls, 0);
});

test('a paused recommendation batch belongs to its original account and cannot be selected after switching login', async t => {
  let uid = '123'; const f = await setup(t, { account: () => uid }); const normal = f.reader.call.bind(f.reader);
  f.reader.call = async (method, params) => { const v = await normal(method, params); if (method === 'recommend_videos') f.controller.scheduler.pause(); return v; };
  await f.controller.scheduler.runNow('autonomous-paused-account'); await pump(f, 2);
  assert.equal(f.store.openRound().feed.length, 3); uid = '999'; f.controller.scheduler.resume(); await pump(f);
  assert.equal(f.counters.prompt, 0); assert.equal(f.store.round('autonomous-paused-account').state, 'failed');
});

test('recent preference context uses only the same account public videos and ignores disabled old iteration', async t => {
  const f = await setup(t, { config: { learningEnabled: false } });
  f.store.set('iteration:123', { version: 9, traits: [{ id: 'private-unused', text: 'DISABLED_ITERATION', reason: '', sourceIds: [] }] });
  const make = (id, kind, accountUid, title) => {
    f.store.start({ id, kind, accountUid, sessionId: f.store.get('binding').sessionId });
    f.store.update(id, { state: 'preview', evidence: { title }, preview: { summary: title, evaluation: title, interest: 0.9 } });
  };
  make('public-interest-own', 'video', '123', 'OWN_PUBLIC_INTEREST');
  make('public-interest-foreign', 'video', '999', 'FOREIGN_PUBLIC_INTEREST');
  make('private-interest-text', 'dm', '123', 'PRIVATE_DM_TEXT');
  await f.controller.scheduler.runNow('autonomous-public-context'); await pump(f);
  assert.match(f.prompts[0], /OWN_PUBLIC_INTEREST/); assert.doesNotMatch(f.prompts[0], /FOREIGN_PUBLIC_INTEREST|PRIVATE_DM_TEXT|DISABLED_ITERATION/);
});

test('an invalid late original selection fails durably instead of leaving the active queue locked', async t => {
  const f = await setup(t, { noResult: true }); await f.controller.scheduler.runNow('autonomous-late-invalid'); await pump(f, 2);
  const run = f.store.run(f.store.openRound().choiceId), events = f.sessions.get(run.sessionId).events;
  events.push({ seq: 1, type: 'user/message', data: { turn: 3, source: { rpcId: run.id } } },
    { seq: 2, type: 'assistant/message', data: { message: { content: [{ type: 'text', text: '{"runId":"wrong"}' }] } } },
    { seq: 3, type: 'turn/end', data: { turn: 3, reason: { kind: 'completed' } } });
  await f.controller.reconcile(run.id); await pump(f, 3);
  assert.equal(f.store.active(), null); assert.equal(f.store.openRound(), null); assert.equal(f.store.run(run.id).state, 'failed');
  assert.equal(f.counters.prompt, 1); assert.equal(f.calls.read.length, 0); assert.equal(f.controller.discovery.budget().calls, 1);
});
