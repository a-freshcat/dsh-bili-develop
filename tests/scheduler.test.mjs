import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { fixture, BV } from './fixtures.mjs';
import { Store } from '../src/store.mjs';
import { Controller } from '../src/controller.mjs';
import { dayWindow, inActivity } from '../src/time.mjs';
import { configOf } from '../src/decision.mjs';
import { DEFAULT_CONFIG } from '../src/store.mjs';

const BV2 = 'BV1xx411c7mE';
const flush = () => new Promise(resolve => setImmediate(resolve));
async function setup(t, options = {}) {
  const clock = { value: Date.parse('2026-10-22T04:00:00Z') };
  const f = fixture(t, { ...options, now: () => clock.value }); await f.bind();
  f.controller.configure({ keywords: ['测试主题'], intervalMinutes: 5, timeZone: 'Asia/Singapore',
    activityStart: '09:00', activityEnd: '23:00', ...options.config });
  const calls = { account: 0, search: 0, read: 0 };
  const reader = { async call(method, params = {}) {
    if (method === 'account') { calls.account++; return { status: 'logged_in', uid: '123' }; }
    if (method === 'search_videos') { calls.search++; return { videos: [{ bvid: BV }, { bvid: BV2 }, { bvid: BV }] }; }
    if (method === 'read_video') { calls.read++; return { ...f.evidence, bvid: params.bvid }; }
    return { protocol: 1, bilibiliApi: '17.4.2' };
  } };
  f.controller.reader = () => reader;
  return { ...f, clock, calls, reader };
}
async function pump(f, steps = 6) {
  for (let i = 0; i < steps; i++) { await flush(); await f.controller.scheduler.tick(); await f.controller.idle(); }
  await flush();
}

test('the reported tomorrow09 schedule explains that today09-12 has ended with quota remaining', async t => {
  const f = await setup(t, { config: { autoEnabled: true, activityStart: '09:00', activityEnd: '12:00', intervalMinutes: 60,
    dailyRoundLimit: 3, dailyAnalysisLimit: 6 } });
  f.clock.value = Date.parse('2026-10-23T06:10:00Z');
  f.store.set('nextRunAt', f.clock.value - 60000);
  const status = f.controller.scheduler.status();
  assert.equal(status.nextRunAt, '2026-10-24T01:00:00.000Z');
  assert.ok(status.budget.analyses < status.budget.analysisLimit && status.budget.rounds < status.budget.roundLimit);
  assert.match(status.schedule?.message || '', /活动时段.*09:00.*12:00/);
  assert.equal(f.calls.search + f.calls.read, 0);
});

test('enabling before the activity start schedules the boundary without adding a full interval first', async t => {
  const f = await setup(t, { config: { intervalMinutes: 60 } });
  f.clock.value = Date.parse('2026-10-23T00:50:00Z'); // 08:50, opens at09:00.
  f.controller.configure({ autoEnabled: true });
  assert.equal(f.controller.scheduler.status().nextRunAt, '2026-10-23T01:00:00.000Z');
  await f.controller.scheduler.tick(); assert.equal(f.calls.search, 0);
  f.clock.value = Date.parse('2026-10-23T01:00:00Z'); await pump(f);
  assert.equal(f.calls.search, 1);
});

test('enabling inside the activity window is due now and the next round still waits its interval', async t => {
  const f = await setup(t, { config: { intervalMinutes: 60 } });
  f.controller.configure({ autoEnabled: true });
  assert.equal(f.controller.scheduler.status().nextRunAt, new Date(f.clock.value).toISOString());
  await pump(f);
  assert.equal(f.calls.search, 1);
  assert.equal(f.store.get('nextRunAt'), f.clock.value + 60 * 60000);
  f.clock.value += 59 * 60000; await pump(f, 2); assert.equal(f.calls.search, 1);
  f.clock.value += 60000; await pump(f); assert.equal(f.calls.search, 2);
});

test('saving unrelated or unchanged settings keeps the due time and the pending browsing round', async t => {
  const f = await setup(t, { config: { autoEnabled: true, intervalMinutes: 60 } });
  await f.controller.scheduler.runNow('keep-pending-on-comment-save'); await flush();
  const due = f.store.get('nextRunAt');
  f.clock.value += 20 * 60000;
  f.controller.configure({ commentMode: 'manual', persona: '保持友善，好奇地观察材料。' });
  assert.equal(f.store.get('nextRunAt'), due);
  assert.equal(f.store.openRound()?.id, 'keep-pending-on-comment-save');
  f.controller.configure(f.store.config()); assert.equal(f.store.get('nextRunAt'), due);
});

test('extending today activity keeps the existing cadence and distinguishes quota waits', async t => {
  const f = await setup(t, { config: { autoEnabled: true, activityEnd: '12:00' } });
  f.clock.value = Date.parse('2026-10-23T06:10:00Z'); f.store.set('nextRunAt', f.clock.value - 60000);
  f.controller.configure({ activityEnd: '23:00' });
  assert.equal(f.controller.scheduler.status().nextRunAt, new Date(f.clock.value).toISOString());
  await pump(f);
  f.controller.configure({ dailyRoundLimit: 1 });
  const status = f.controller.scheduler.status();
  assert.equal(status.schedule.code, 'quota'); assert.match(status.schedule.message, /轮次.*1\/1/);
  assert.equal(status.nextRunAt, '2026-10-24T01:00:00.000Z');
});

test('interval changes use the last admitted round and unrelated saves do not add more delay', async t => {
  const f = await setup(t, { config: { autoEnabled: true, intervalMinutes: 60 } });
  await f.controller.scheduler.runNow('last-round-cadence'); await pump(f);
  const started = f.clock.value; f.clock.value += 10 * 60000;
  f.controller.configure({ intervalMinutes: 30 });
  assert.equal(f.store.get('nextRunAt'), started + 30 * 60000);
  assert.equal(f.controller.scheduler.status().schedule.code, 'interval');
  f.controller.configure({ dmMaxChars: 200 }); assert.equal(f.store.get('nextRunAt'), started + 30 * 60000);
});

test('background timer drives a due scheduled round without settings refresh or manual tick', async t => {
  const f = await setup(t, { config: { autoEnabled: true } });
  t.mock.timers.enable({ apis: ['setInterval'] });
  f.clock.value += 5 * 60000;
  f.controller.scheduler.start();
  await flush();
  assert.equal(f.calls.search, 1);
  t.mock.timers.tick(15000); await flush(); await f.controller.idle();
  assert.equal(f.calls.read, 1);
  t.mock.timers.tick(15000); await flush();
  assert.equal(f.store.recentRounds()[0].source, 'scheduled');
  assert.equal(f.store.recentRounds()[0].state, 'completed');
  f.controller.scheduler.close();
  f.clock.value += 5 * 60000;
  t.mock.timers.tick(60000); await flush();
  assert.equal(f.calls.search, 1);
});

test('manual and keyword rounds share one durable analysis budget and skip seen videos', async t => {
  const f = await setup(t, { config: { dailyAnalysisLimit: 2, videosPerRound: 2 } });
  await f.controller.start({ requestId: 'manual-first', bvid: BV }); await f.controller.idle();
  await f.controller.scheduler.runNow('keyword-round-1'); await pump(f);
  const usage = f.controller.scheduler.status().budget;
  assert.equal(usage.analyses, 2); assert.equal(usage.rounds, 1); assert.equal(usage.uniqueVideos, 2);
  assert.equal(f.calls.read, 2); assert.equal(f.calls.search, 1); assert.equal(f.counters.prompt, 2);
  assert.equal(f.counters.create, 1);
  const round = f.store.round('keyword-round-1');
  assert.equal(round.state, 'completed'); assert.equal(round.analysisIds.length, 1);
  assert.equal(f.store.run(round.analysisIds[0]).sessionId, f.store.get('binding').sessionId);
  await assert.rejects(f.controller.start({ requestId: 'over-budget', bvid: BV }), { code: 'ANALYSIS_LIMIT' });
});

test('zero means disabled, immediate rounds cannot bypass it, duplicate requests cost once', async t => {
  const f = await setup(t, { config: { dailyAnalysisLimit: 0 } });
  await assert.rejects(f.controller.scheduler.runNow('zero-round-1'), { code: 'ANALYSIS_LIMIT' });
  await assert.rejects(f.controller.start({ requestId: 'zero-video-1', bvid: BV }), { code: 'ANALYSIS_LIMIT' });
  assert.equal(f.calls.read + f.calls.search, 0);
  f.controller.configure({ dailyAnalysisLimit: 2, dailyRoundLimit: 0 });
  await assert.rejects(f.controller.scheduler.runNow('zero-round-2'), { code: 'ROUND_LIMIT' });
  const request = { requestId: 'only-once', bvid: BV };
  await f.controller.start(request); await f.controller.idle();
  assert.equal((await f.controller.start(request)).fresh, false);
  assert.equal(f.controller.scheduler.status().budget.analyses, 1);
});

test('concurrent video admissions cannot overshoot quota or reserve two jobs', async t => {
  const f = await setup(t, { config: { dailyAnalysisLimit: 1 } });
  const results = await Promise.allSettled([
    f.controller.start({ requestId: 'concurrent-one', bvid: BV }),
    f.controller.start({ requestId: 'concurrent-two', bvid: BV2 }),
  ]);
  await f.controller.idle();
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(f.controller.scheduler.status().budget.analyses, 1);
  assert.equal(f.calls.read, 1);
});

test('a manual video finishing during round preparation cannot leave an empty charged round', async t => {
  const f = await setup(t, { config: { dailyAnalysisLimit: 1 } });
  const normal = f.host.requireBinding.bind(f.host);
  let release, first = true;
  f.host.requireBinding = async () => {
    if (first) { first = false; return new Promise(resolve => { release = resolve; }); }
    return normal();
  };
  const pending = f.controller.scheduler.runNow('delayed-round');
  await f.controller.start({ requestId: 'last-manual-slot', bvid: BV }); await f.controller.idle();
  const expected = assert.rejects(pending, { code: 'ANALYSIS_LIMIT' });
  release(await normal()); await expected;
  assert.equal(f.controller.scheduler.status().budget.rounds, 0);
  assert.equal(f.controller.scheduler.status().budget.analyses, 1);
});

test('pause during search persists across restart and resume does not repeat search or round charge', async t => {
  const f = await setup(t);
  let release;
  const normal = f.reader.call.bind(f.reader);
  f.reader.call = async (method, params) => method === 'search_videos' ?
    new Promise(resolve => { f.calls.search++; release = resolve; }) : normal(method, params);
  await f.controller.scheduler.runNow('paused-search'); await flush();
  assert.equal(typeof release, 'function');
  f.controller.scheduler.pause(); release({ videos: [{ bvid: BV }] }); await flush();
  assert.equal(f.calls.read, 0); assert.equal(f.store.openRound().state, 'paused');
  const reopened = new Store(join(f.root, 'state.sqlite'));
  assert.equal(reopened.get('browsingPaused'), true); reopened.close();
  f.controller.close(); f.reader.call = normal;
  const after = new Controller({ store: f.store, host: f.host, reader: () => f.reader, now: () => f.clock.value });
  t.after(() => after.close());
  assert.equal(after.scheduler.paused, true);
  after.scheduler.resume(); await pump({ ...f, controller: after });
  assert.equal(f.calls.search, 1); assert.equal(f.calls.read, 1);
  assert.equal(after.scheduler.status().budget.rounds, 1);
  assert.equal(f.store.round('paused-search').state, 'completed');
});

test('pause finishes the admitted video and prevents the next one until resumed', async t => {
  const f = await setup(t, { config: { videosPerRound: 2 } });
  let release;
  const normal = f.reader.call.bind(f.reader);
  f.reader.call = async (method, params) => method === 'read_video' && !release ?
    new Promise(resolve => { release = () => resolve({ ...f.evidence, bvid: params.bvid }); f.calls.read++; }) : normal(method, params);
  await f.controller.scheduler.runNow('pause-after-admission'); await flush();
  await f.controller.scheduler.tick(); await flush();
  assert.equal(typeof release, 'function');
  f.controller.scheduler.pause(); release(); await f.controller.idle(); await pump(f, 2);
  assert.equal(f.calls.read, 1); assert.equal(f.counters.prompt, 1);
  f.controller.scheduler.resume(); await pump(f);
  assert.equal(f.calls.read, 2); assert.equal(f.counters.prompt, 2);
});

test('scheduled rounds respect local windows and daily caps, then resume next day', async t => {
  const f = await setup(t, { config: { autoEnabled: true, dailyRoundLimit: 1 } });
  f.clock.value = Date.parse('2026-10-22T00:00:00Z');
  f.store.set('nextRunAt', f.clock.value);
  await f.controller.scheduler.tick();
  assert.equal(f.calls.search, 0);
  assert.equal(f.controller.scheduler.status().nextRunAt, '2026-10-22T01:00:00.000Z');
  f.clock.value = Date.parse('2026-10-22T01:00:00Z'); await pump(f);
  assert.equal(f.calls.search, 1); assert.equal(f.controller.scheduler.status().budget.rounds, 1);
  f.clock.value += 3600000; await pump(f, 2); assert.equal(f.calls.search, 1);
  f.clock.value += 86400000; await pump(f);
  assert.equal(f.calls.search, 2); assert.equal(f.controller.scheduler.status().budget.rounds, 1);
});

test('timezone changes, lower limits and restart do not reset an existing period', async t => {
  const f = await setup(t, { config: { timeZone: 'UTC', dailyAnalysisLimit: 2 } });
  f.clock.value = Date.parse('2026-10-22T23:50:00Z');
  await f.controller.start({ requestId: 'timezone-first', bvid: BV }); await f.controller.idle();
  const original = f.controller.scheduler.status().budget;
  f.controller.configure({ timeZone: 'Asia/Tokyo', dailyAnalysisLimit: 1 });
  assert.equal(f.controller.scheduler.status().budget.end, original.end);
  await assert.rejects(f.controller.start({ requestId: 'timezone-second', bvid: BV2 }), { code: 'ANALYSIS_LIMIT' });
  const reopened = new Store(join(f.root, 'state.sqlite'));
  assert.equal(reopened.budget(reopened.config(), f.clock.value).analyses, 1); reopened.close();
  f.clock.value = original.end + 60000;
  const transition = f.controller.scheduler.status().budget;
  assert.equal(transition.analyses, 0); assert.ok(transition.end >= original.end + 86400000);
});

test('DST and overnight activity use local calendar boundaries', () => {
  const spring = dayWindow(Date.parse('2026-03-08T12:00:00Z'), 'America/New_York');
  const autumn = dayWindow(Date.parse('2026-11-01T12:00:00Z'), 'America/New_York');
  assert.equal(spring.end - spring.start, 23 * 3600000);
  assert.equal(autumn.end - autumn.start, 25 * 3600000);
  const config = { timeZone: 'Asia/Singapore', activityStart: '18:00', activityEnd: '09:00' };
  assert.equal(inActivity(Date.parse('2026-10-22T16:00:00Z'), config), true);
  assert.equal(inActivity(Date.parse('2026-10-22T04:00:00Z'), config), false);
});

test('status refresh never starts work and an exhausted round budget schedules the next day', async t => {
  const f = await setup(t, { config: { autoEnabled: true, dailyRoundLimit: 0 } });
  for (let i = 0; i < 3; i++) await f.controller.status();
  assert.equal(f.calls.account + f.calls.search + f.calls.read, 0);
  assert.equal(f.controller.scheduler.status().nextRunAt, null);
});

test('a round deadline stops new videos and repeated round IDs are idempotent', async t => {
  const f = await setup(t, { config: { roundTimeoutMinutes: 1 } });
  await f.controller.scheduler.runNow('deadline-round'); await flush();
  f.clock.value += 61000; await pump(f, 2);
  assert.equal(f.calls.read, 0); assert.equal(f.store.round('deadline-round').state, 'completed');
  assert.equal((await f.controller.scheduler.runNow('deadline-round')).fresh, false);
  assert.equal(f.controller.scheduler.status().budget.rounds, 1);
});

test('search failure is recorded without refunding a started round', async t => {
  const f = await setup(t);
  f.reader.call = async () => { throw new Error('private diagnostic'); };
  await f.controller.scheduler.runNow('search-failed'); await flush();
  assert.equal(f.store.round('search-failed').state, 'failed');
  assert.doesNotMatch(JSON.stringify(f.controller.scheduler.status()), /private diagnostic/);
  assert.equal(f.controller.scheduler.status().budget.rounds, 1);
  assert.equal(f.controller.scheduler.status().budget.analyses, 0);
});

test('shutdown after an in-flight search starts no video or model request', async t => {
  const f = await setup(t);
  let release;
  const normal = f.reader.call.bind(f.reader);
  f.reader.call = async (method, params) => method === 'search_videos' ?
    new Promise(resolve => { release = resolve; }) : normal(method, params);
  await f.controller.scheduler.runNow('shutdown-search'); await flush();
  assert.equal(typeof release, 'function');
  f.controller.close(); release({ videos: [{ bvid: BV }] }); await flush();
  assert.equal(f.calls.read, 0); assert.equal(f.counters.prompt, 0);
  assert.equal(f.controller.scheduler.status().budget.analyses, 0);
});

test('legacy video attempts migrate into the ledger exactly once', async t => {
  const f = await setup(t);
  await f.controller.start({ requestId: 'legacy-migration', bvid: BV }); await f.controller.idle();
  f.store.db.exec('DELETE FROM usage_ledger');
  for (let i = 0; i < 2; i++) {
    const reopened = new Store(join(f.root, 'state.sqlite'));
    assert.equal(reopened.budget(reopened.config(), f.clock.value).analyses, 1); reopened.close();
  }
});

test('restart after admission consumes the attempt without repeating the same video', async t => {
  const f = await setup(t);
  await f.controller.scheduler.runNow('restart-admitted'); await flush();
  f.store.start({ id: 'restart-admitted-v0', kind: 'video', bvid: BV,
    sessionId: f.store.get('binding').sessionId, roundId: 'restart-admitted', accountUid: '123', now: f.clock.value });
  await f.controller.recover(); await pump(f, 2);
  assert.equal(f.store.run('restart-admitted-v0').state, 'interrupted');
  assert.equal(f.store.round('restart-admitted').state, 'completed');
  assert.equal(f.calls.read, 0); assert.equal(f.counters.prompt, 0);
  assert.equal(f.controller.scheduler.status().budget.analyses, 1);
});

test('maintenance and a pending round prevent environment replacement or a new scheduled admission', async t => {
  const f = await setup(t, { config: { autoEnabled: true } });
  f.live.get(f.store.get('binding').sessionId).status = 'maintenance';
  f.store.set('nextRunAt', f.clock.value);
  await f.controller.scheduler.tick();
  assert.equal(f.calls.search, 0); assert.equal(f.controller.scheduler.status().budget.rounds, 0);
  f.live.get(f.store.get('binding').sessionId).status = 'idle';
  await f.controller.scheduler.runNow('protected-reader'); await flush();
  assert.throws(() => f.controller.preparePython(), { code: 'RUN_BUSY' });
});

test('M2 settings reject invalid budgets, times and unconfigured automatic browsing', () => {
  for (const input of [{ dailyAnalysisLimit: -1 }, { videosPerRound: 0 }, { intervalMinutes: 0 },
    { timeZone: 'invalid-zone' }, { activityStart: '25:00' }, { keywords: [''] }, { autoEnabled: true }]) {
    assert.throws(() => configOf(input, DEFAULT_CONFIG), { code: 'INVALID_CONFIG' });
  }
});
