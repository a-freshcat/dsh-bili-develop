import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fixture, BV, preview } from './fixtures.mjs';
import { Controller } from '../src/controller.mjs';
import { Store, DEFAULT_CONFIG } from '../src/store.mjs';
import { configOf } from '../src/decision.mjs';

const day = Date.parse('2026-10-21T02:00:00Z');
const observation = { expression: '足够验证', meaning: '表示证据足够', context: '讨论论据时', avoid: '不确定时', example: '这些材料足够验证这个小结论。', quote: '测试字幕原文内容足够验证。', reason: '在提供的字幕中确实看到。' };
function setup(t, extra = {}) {
  let now = day;
  const f = fixture(t, { now: () => now, output: (_text, id) => {
    if (id.startsWith('learn-')) {
      const run = f.store.run(id), response = f.response(run);
      // Existing cases exercise legacy provenance decisions alongside the new required profile.
      return JSON.stringify(typeof response === 'object' ? { integrated_persona: {
        text: run.learningReview.iterationBefore.profile?.text || '', reason: '按整体比较保留或调整人设。',
        source_ids: run.learningReview.sources.map(s => s.id) }, ...response } : response);
    }
    return JSON.stringify({ ...preview(id), learning_observations: [observation], used_expression_ids: [] });
  }, ...extra });
  f.response = run => ({ runId: run.id, comparison: '与原有迭代相比，保留稳定习惯，对新的证据保持观察。', decisions: run.learningReview.iterationBefore.traits.map(t => ({ id: t.id, action: 'keep', reason: '仍适合基础人设。' })), additions: [], expression_decisions: [], report: '', direction: '' });
  f.now = value => { now = value; };
  f.read = async (id, bvid = BV) => {
    f.controller.reader = () => ({ async call(method) { assert.equal(method, 'read_video'); return { ...f.evidence, bvid }; } });
    await f.controller.start({ requestId: id, bvid }); await f.controller.idle(); return f.store.run(id);
  };
  f.enable = () => f.controller.configure({ learningEnabled: true, timeZone: 'Asia/Singapore' });
  f.nextDay = () => { now = Date.parse('2026-10-22T02:00:00Z'); };
  return f;
}

test('learning defaults off, adds no extra model call and never changes the base persona', async t => {
  const f = setup(t); await f.bind(); const persona = f.store.config().persona;
  await f.read('learning-off-1'); assert.equal(f.controller.learning.entries().length, 0); assert.equal(f.counters.prompt, 1);
  assert.equal(f.store.config().persona, persona); assert.deepEqual(f.controller.learning.iteration().traits, []);
  await assert.rejects(f.controller.learning.review(), { code: 'LEARNING_DISABLED' });
});

test('observations persist with literal sources; same video is one source and ingestion never adopts', async t => {
  const f = setup(t); await f.bind(); f.enable(); const persona = f.store.config().persona;
  await f.read('learning-source-1'); await f.read('learning-source-2');
  let entry = f.controller.learning.entries()[0]; assert.equal(entry.state, 'candidate'); assert.equal(entry.sourceCount, 1);
  assert.equal(f.counters.prompt, 2); await f.controller.reconcile('learning-source-2'); assert.equal(f.counters.prompt, 2);
  await f.read('learning-source-3', 'BV1xx411c7mE'); entry = f.controller.learning.entries()[0];
  assert.equal(entry.sourceCount, 2); assert.equal(entry.state, 'candidate'); assert.equal(f.store.config().persona, persona);
  assert.match(readFileSync(join(f.workspacePath, '.bilibili-harness/learning-123.md'), 'utf8'), /迭代人设.*表达记忆/);
  const s = new Store(join(f.root, 'state.sqlite')); assert.ok(s.db.prepare('SELECT data FROM learning_entries').get()); s.close();
});

test('invented learning source or invalid usage cannot corrupt an otherwise valid video preview', async t => {
  const f = setup(t, { output: (_text, id) => JSON.stringify({ ...preview(id), learning_observations: [{ ...observation, quote: '材料里没有的流行语' }] }) });
  await f.bind(); f.enable(); const run = await f.read('learning-fake-source');
  assert.equal(run.state, 'preview'); assert.match(run.learningNotice, /原文/); assert.equal(f.controller.learning.entries().length, 0);
  assert.equal(f.store.db.prepare('SELECT COUNT(*) AS n FROM learning_observations').get().n, 0);
});

test('daily review compares previous traits before autonomous selection and adopts only proven expressions', async t => {
  const f = setup(t), binding = await f.bind(); f.enable(); const persona = f.store.config().persona;
  await f.read('daily-source-1'); await f.read('daily-source-2', 'BV1xx411c7mE');
  f.store.set('iteration:123', { version: 4, traits: [{ id: 'old-trait', text: '多用感叹句', reason: '旧经历', sourceIds: ['old-run'] }] });
  const expression = f.controller.learning.entries()[0];
  f.response = run => ({ ...setupResponse(run), decisions: [{ id: 'old-trait', action: 'remove', reason: '相比以前，新的交流更适合平实表达。' }],
    additions: [{ text: '讨论证据时倾向简短明确。', reason: '连续两次遇到论据话题。', source_ids: [run.learningReview.sources[0].id] }],
    expression_decisions: [{ id: expression.id, action: 'adopt', reason: '两个独立视频出现，含义和语境明确。' }], persona: '外部企图覆盖基础人设' });
  f.nextDay(); const result = await f.controller.learning.review(); await f.controller.idle();
  assert.equal(f.store.run(result.id).state, 'completed'); assert.equal(f.store.run(result.id).sessionId, binding.sessionId);
  assert.match(f.store.run(result.id).promptText, /不是单纯总结/); assert.match(f.store.run(result.id).promptText, /old-trait/);
  assert.equal(f.store.config().persona, persona); assert.equal(f.controller.learning.iteration().version, 5);
  assert.equal(f.controller.learning.iteration().traits[0].text, '讨论证据时倾向简短明确。');
  assert.equal(f.controller.learning.entries()[0].state, 'active'); assert.equal(f.counters.create, 1);
  assert.equal(f.counters.prompt, 3); assert.equal(f.store.count(), 2, 'daily review has its own panel, not video history');
  const snapshot = f.controller.learning.context('123', f.evidence); assert.equal(snapshot.expressionIds[0], expression.id); assert.match(snapshot.text, /迭代人设/);
});
const setupResponse = run => ({ runId: run.id, comparison: '与以前比较后，保留适合的部分并做少量调整。', decisions: [], additions: [], expression_decisions: [], report: '', direction: '' });

test('knowledge advice participates in comparison separately from actual sources and unloading preserves learned traits', async t => {
  const f = setup(t); await f.bind(); f.enable(); f.controller.configure({ learningKnowledgePacks: ['natural-short-zh'] });
  await f.read('pack-review-source');
  f.store.set('iteration:123', { version: 2, traits: [{ id: 'existing-trait', text: '保留自己的正式口吻', reason: '真实经历', sourceIds: ['pack-review-source'] }] });
  f.nextDay(); const { id } = await f.controller.learning.review(); await f.controller.idle();
  const run = f.store.run(id); assert.equal(run.state, 'completed');
  assert.match(run.promptText, /知识包本身不算交流证据/);
  assert.deepEqual(run.learningReview.knowledgePacks, [{ id: 'natural-short-zh', version: '1.0.0' }]);
  assert.ok(run.learningReview.sources.every(s => s.id !== 'natural-short-zh')); assert.equal(run.learningReview.stats.videos, 1);
  const prior = f.controller.learning.iteration(); f.controller.configure({ learningKnowledgePacks: [] });
  assert.deepEqual(f.controller.learning.iteration(), prior, 'unload is not a silent memory wipe');
});

test('a daily comparison cannot invent a knowledge pack evidence source or apply after its selection changes', async t => {
  for (const stale of [false, true]) {
    const f = setup(t); await f.bind(); f.enable(); f.controller.configure({ learningKnowledgePacks: ['natural-short-zh'] });
    await f.read('pack-evidence-' + stale); f.nextDay();
    f.response = run => {
      if (stale) f.store.set('config', { ...f.store.config(), learningKnowledgePacks: [] });
      return { ...setupResponse(run), additions: stale ? [] : [{ text: '新习惯', reason: '参考建议', source_ids: ['natural-short-zh'] }] };
    };
    const { id } = await f.controller.learning.review(); await f.controller.idle();
    assert.equal(f.store.run(id).state, 'failed');
    if (stale) assert.equal(f.store.run(id).error.code, 'LEARNING_STALE');
    assert.deepEqual(f.controller.learning.iteration().traits, []);
  }
});

test('omitting an old trait rejects the whole daily mutation, keeping base and learned state intact', async t => {
  const f = setup(t); await f.bind(); f.enable(); await f.read('compare-source-1');
  f.store.set('iteration:123', { version: 2, traits: [{ id: 'trait-kept', text: '保留旧习惯', reason: '过去依据', sourceIds: [] }] });
  f.response = setupResponse; f.nextDay(); const { id } = await f.controller.learning.review(); await f.controller.idle();
  assert.equal(f.store.run(id).state, 'failed'); assert.equal(f.store.run(id).error.code, 'LEARNING_COMPARE');
  assert.equal(f.controller.learning.iteration().version, 2); assert.equal(f.controller.learning.reviews()[0].state, 'failed');
});

test('daily adoption cannot bypass source minimum through adopt or reduce', async t => {
  for (const action of ['adopt', 'reduce']) {
    const f = setup(t); await f.bind(); f.enable(); await f.read('minimum-source-' + action); f.nextDay();
    const entry = f.controller.learning.entries()[0]; f.response = run => ({ ...setupResponse(run), expression_decisions: [{ id: entry.id, action, reason: '想立即使用' }] });
    const { id } = await f.controller.learning.review(); await f.controller.idle(); assert.equal(f.store.run(id).state, 'failed');
    assert.equal(f.controller.learning.entries()[0].state, 'candidate');
  }
});

test('daily report and future direction are independent presentation settings; advice stays advisory', async t => {
  const f = setup(t); await f.bind(); f.enable();
  f.controller.configure({ learningAdvice: '可以试试更简短', learningDailyReport: true, learningDirectionSuggestions: false, learningReportDetail: 'full' });
  await f.read('report-source-1'); f.nextDay();
  f.response = run => ({ ...setupResponse(run), report: '本期观察到一个候选，未采用；没有足够证据改变旧习惯。' });
  const { id } = await f.controller.learning.review(); await f.controller.idle();
  assert.equal(f.store.run(id).state, 'completed'); assert.match(f.store.run(id).promptText, /由你判断是否采纳/);
  assert.match(f.store.run(id).promptText, /可以试试更简短/); assert.match(f.controller.learning.reviews()[0].report, /未采用/);
  assert.equal(f.controller.learning.reviews()[0].direction, '');
});

test('disabled reporting still runs daily comparison, but rejects unsolicited report text', async t => {
  const f = setup(t); await f.bind(); f.enable(); await f.read('silent-source-1'); f.nextDay();
  f.response = run => ({ ...setupResponse(run), report: '不应生成的日报' });
  const { id } = await f.controller.learning.review(); await f.controller.idle(); assert.equal(f.store.run(id).state, 'failed');
  assert.equal(f.controller.learning.iteration().version, 0);
});

test('repeated manual review, restart and overlapping timezone do not re-prompt or re-count the same materials', async t => {
  const f = setup(t); await f.bind(); f.enable(); await f.read('dedupe-source-1'); f.nextDay();
  const first = await f.controller.learning.review(); await f.controller.idle();
  await f.controller.learning.review(); assert.equal(f.counters.prompt, 2);
  const after = new Controller({ store: f.store, host: f.host, reader: () => { throw new Error('no network'); }, now: () => Date.parse('2026-10-22T02:00:00Z') });
  await after.recover(); after.configure({ timeZone: 'UTC' }); await after.learning.review(); await after.idle();
  assert.equal(f.counters.prompt, 2); assert.equal(f.store.run(first.id).state, 'completed');
  assert.equal(f.store.db.prepare('SELECT COUNT(*) AS n FROM learning_review_sources').get().n, 1);
  assert.ok(after.learning.reviews().some(r => r.stats.observations === 0)); after.close();
});

test('daily scheduling waits for configured local time and for the native dialogue to be idle', async t => {
  const f = setup(t); await f.bind(); f.enable(); await f.read('schedule-source-1');
  f.controller.configure({ learningDailyTime: '09:30' }); f.now(Date.parse('2026-10-22T01:29:00Z'));
  f.controller.learning.tick(); await f.controller.idle(); assert.equal(f.counters.prompt, 1);
  f.now(Date.parse('2026-10-22T01:30:00Z')); f.live.get(f.store.get('binding').sessionId).status = 'running';
  await assert.rejects(f.controller.learning.review(), { code: 'SESSION_BUSY' });
  f.live.get(f.store.get('binding').sessionId).status = 'idle'; await f.controller.learning.review(); await f.controller.idle();
  assert.equal(f.counters.prompt, 2);
});

test('user blocks remain effective in context and in queued public drafts, even with learning disabled', async t => {
  const f = setup(t, { output: (_text, id) => JSON.stringify({ ...preview(id), comment: '足够验证这个内容。', learning_observations: [observation] }) });
  await f.bind(); f.enable(); const run = await f.read('block-source-1'); const entry = f.controller.learning.entries()[0];
  f.controller.learning.change({ id: entry.id, version: entry.version, operation: 'block' });
  assert.throws(() => f.controller.comments.assertDraft(f.controller.comments.get(run.id), false, false), { code: 'LEARNING_BLOCKED' });
  assert.match(f.controller.learning.context('123').text, /用户禁用/);
  f.controller.configure({ learningEnabled: false }); assert.throws(() => f.controller.learning.checkOutput('足够验证', '123'), { code: 'LEARNING_BLOCKED' });
  f.controller.learning.checkOutput('足够验证', '456');
  assert.throws(() => f.controller.learning.change({ id: entry.id, version: entry.version, operation: 'unblock' }), { code: 'LEARNING_STALE' });
  const blocked = f.controller.learning.entry(entry.id);
  assert.throws(() => f.controller.learning.change({ id: entry.id, version: blocked.version, operation: 'rollback', eventId: 1 }), { code: 'LEARNING_ROLLBACK' });
  f.controller.learning.change({ id: entry.id, version: blocked.version, operation: 'unblock' });
  assert.equal(f.controller.learning.entry(entry.id).state, 'candidate');
});

test('model cannot restore a user-disabled expression; invalid source ids cannot create persona traits', async t => {
  const f = setup(t); await f.bind(); f.enable(); await f.read('pinned-source-1'); const e = f.controller.learning.entries()[0];
  f.controller.learning.change({ id: e.id, version: e.version, operation: 'block' }); f.nextDay();
  f.response = run => ({ ...setupResponse(run), expression_decisions: [{ id: e.id, action: 'adopt', reason: '想恢复' }] });
  const { id } = await f.controller.learning.review(); await f.controller.idle(); assert.equal(f.store.run(id).state, 'failed'); assert.equal(f.controller.learning.entry(e.id).state, 'blocked');
  f.now(Date.parse('2026-10-23T02:00:00Z')); await f.read('pinned-source-2'); f.now(Date.parse('2026-10-24T02:00:00Z'));
  f.response = run => ({ ...setupResponse(run), additions: [{ text: '虚构成长', reason: '没有本期依据', source_ids: ['unknown-id'] }] });
  const second = await f.controller.learning.review(); await f.controller.idle(); assert.equal(f.store.run(second.id).error.code, 'LEARNING_SOURCE');
  assert.deepEqual(f.controller.learning.iteration().traits, []);
});

test('iteration and expression rollback use current versions and never rewrite the user persona', async t => {
  const f = setup(t); await f.bind(); f.enable(); const persona = f.store.config().persona; await f.read('rollback-source-1'); f.nextDay();
  f.response = run => ({ ...setupResponse(run), additions: [{ text: '简短评价', reason: '基于今天材料', source_ids: [run.learningReview.sources[0].id] }] });
  const { id } = await f.controller.learning.review(); await f.controller.idle();
  const iteration = f.controller.learning.iteration(); f.controller.learning.rollbackIteration({ reviewId: id, version: iteration.version });
  assert.deepEqual(f.controller.learning.iteration().traits, []); assert.equal(f.store.config().persona, persona);
  assert.throws(() => f.controller.learning.rollbackIteration({ reviewId: id, version: iteration.version }), { code: 'LEARNING_ROLLBACK' });
  const e = f.controller.learning.entries()[0]; f.controller.learning.change({ id: e.id, version: e.version, operation: 'reduce' });
  const latest = f.controller.learning.status().entries[0];
  f.controller.learning.change({ id: e.id, version: latest.version, operation: 'rollback', eventId: latest.rollbackEventId });
  assert.equal(f.controller.learning.entry(e.id).state, 'candidate');
});

test('recovery reads the original daily result and does not submit a second model request', async t => {
  const f = setup(t); await f.bind(); f.enable(); await f.read('recovery-source-1'); f.nextDay();
  const original = f.controller.learning.complete.bind(f.controller.learning); let failed = true;
  f.controller.learning.complete = (run, raw) => { if (failed) throw new Error('simulated local failure'); return original(run, raw); };
  const { id } = await f.controller.learning.review(); await f.controller.idle();
  f.store.update(id, { state: 'awaiting_model' }); failed = false; await f.controller.recover();
  assert.equal(f.store.run(id).state, 'completed'); assert.equal(f.counters.prompt, 2);
});

test('draft usage is counted only when the injected expression appears in the actual draft', async t => {
  const f = setup(t); await f.bind(); f.enable(); await f.read('usage-source-1');
  const e = f.controller.learning.entries()[0]; f.controller.learning.change({ id: e.id, version: e.version, operation: 'reduce' });
  f.ctx.sessionController.prompt = async request => {
    f.counters.prompt++; const events = f.sessions.get(request.sessionId).events, seq = events.length + 1;
    const v = { ...preview(request.requestId), comment: '这些材料足够验证。', learning_observations: [], used_expression_ids: [e.id] };
    events.push({ seq, type: 'user/message', data: { source: { rpcId: request.requestId } } }, { seq: seq + 1, type: 'assistant/message', data: { message: { content: [{ type: 'text', text: JSON.stringify(v) }] } } }, { seq: seq + 2, type: 'turn/end', data: { reason: { kind: 'completed' } } });
  };
  await f.read('usage-source-2'); assert.equal(f.controller.learning.entry(e.id).uses, 1);
  assert.equal(f.store.db.prepare('SELECT COUNT(*) AS n FROM comment_attempts').get().n, 0);
  const current = f.controller.learning.status().entries[0];
  f.controller.learning.change({ id: current.id, version: current.version, operation: 'rollback', eventId: current.rollbackEventId });
  assert.equal(f.controller.learning.entry(e.id).state, 'candidate');
  assert.equal(f.controller.learning.entry(e.id).uses, 1, 'style rollback must not erase a real draft usage');
  assert.equal(f.controller.learning.entry(e.id).sourceCount, 1);
});

test('learning settings reject malformed clock and advice, while ordinary settings preserve the iterative layer', () => {
  assert.throws(() => configOf({ learningDailyTime: '24:00' }, DEFAULT_CONFIG), { code: 'INVALID_CONFIG' });
  assert.throws(() => configOf({ learningAdvice: 'x'.repeat(1001) }, DEFAULT_CONFIG), { code: 'INVALID_CONFIG' });
  const c = configOf({ learningDailyTime: '00:10', learningDailyReport: true }, DEFAULT_CONFIG);
  assert.equal(c.learningDailyReport, true); assert.equal(c.learningEnabled, false);
});

test('daily model budget is reserved before admission, failures consume it and zero makes no request', async t => {
  const f = setup(t); await f.bind(); f.enable(); f.controller.configure({ learningDailyReviewLimit: 0 });
  f.now(day - 86400000); await f.read('budget-source-old'); f.now(day); await f.read('budget-source-new'); f.nextDay();
  await assert.rejects(f.controller.learning.review(), { code: 'LEARNING_BUDGET' });
  assert.equal(f.counters.prompt, 2); assert.equal(f.store.active(), null);
  assert.equal(f.store.db.prepare('SELECT COUNT(*) AS n FROM learning_review_sources').get().n, 0);
  f.controller.configure({ learningDailyReviewLimit: 1 }); f.response = () => 'not a structured review';
  const { id } = await f.controller.learning.review(); await f.controller.idle(); assert.equal(f.store.run(id).state, 'failed');
  assert.equal(f.controller.learning.budget().calls, 1);
  await assert.rejects(f.controller.learning.review(), { code: 'LEARNING_BUDGET' });
  assert.equal(f.counters.prompt, 3); assert.equal(f.store.db.prepare('SELECT COUNT(*) AS n FROM learning_review_sources').get().n, 1);
});

test('a changed base or iteration version invalidates the whole pending review', async t => {
  for (const changed of ['base', 'iteration']) {
    const f = setup(t); await f.bind(); f.enable(); await f.read('stale-review-' + changed); f.nextDay();
    f.response = run => {
      if (changed === 'base') f.store.set('config', { ...f.store.config(), persona: '用户刚刚更新的基础人设。' });
      else f.store.set('iteration:123', { version: 100, traits: [] });
      return { ...setupResponse(run), additions: [{ text: '不应覆盖新版本', reason: '旧快照', source_ids: [run.learningReview.sources[0].id] }] };
    };
    const { id } = await f.controller.learning.review(); await f.controller.idle();
    assert.equal(f.store.run(id).error.code, 'LEARNING_STALE'); assert.deepEqual(f.controller.learning.iteration().traits, []);
    if (changed === 'base') assert.equal(f.store.config().persona, '用户刚刚更新的基础人设。');
    else assert.equal(f.controller.learning.iteration().version, 100);
  }
});

test('a full catalogue archives only model-retired entries, preserving their provenance and user bans', async t => {
  const f = setup(t); await f.bind(); f.enable();
  for (let i = 0; i < 200; i++) f.controller.learning.saveEntry({ ...observation, id: 'capacity-' + i, accountUid: '123', expression: '历史表达' + i,
    version: 1, state: i === 0 ? 'blocked' : i === 1 ? 'inactive' : 'candidate', uses: 0, sources: [], sourceCount: 1 });
  const run = await f.read('capacity-source-1'); assert.equal(run.state, 'preview');
  assert.equal(f.controller.learning.entry('capacity-0').state, 'blocked'); assert.equal(f.controller.learning.entry('capacity-1').state, 'archived');
  assert.equal(f.controller.learning.entries().filter(e => e.state !== 'archived').length, 200);
  assert.ok(f.controller.learning.entries().some(e => e.expression === observation.expression));
  assert.equal(f.controller.learning.status().counts.archived, 1);
  const last = f.controller.learning.events('123', 20).find(e => e.entity === 'capacity-1');
  assert.throws(() => f.controller.learning.change({ id: 'capacity-1', operation: 'rollback', version: 2, eventId: last.id }), { code: 'LEARNING_LIMIT' });
});

test('direction guides consolidation and changing it rejects an in-flight review', async t => {
  const f = setup(t); await f.bind(); f.enable();
  f.controller.configure({ learningAdvice: '合并重复习惯，表达要有生活化的幽默。' });
  await f.read('direction-source'); f.nextDay();
  f.response = run => {
    assert.match(f.controller.learning.reviewPrompt(run, f.store.config()), /合并重复习惯/);
    f.store.set('config', { ...f.store.config(), learningAdvice: '更简洁' });
    return setupResponse(run);
  };
  const { id } = await f.controller.learning.review(); await f.controller.idle();
  assert.equal(f.store.run(id).error.code, 'LEARNING_STALE');
  assert.equal(f.controller.learning.iteration().version, 0);
});

test('discarded traits can be picked up within a week and expire beyond it without rollback revival', async t => {
  const f = setup(t); await f.bind(); f.enable(); await f.read('discard-trait-source');
  f.store.set('iteration:123', { version: 1, traits: [{ id: 'discarded-trait', text: '重复习惯', reason: '旧依据', sourceIds: [] }] });
  f.response = run => ({ ...setupResponse(run), decisions: [{ id: 'discarded-trait', action: 'remove', reason: '无用记录，丢弃。' }] });
  f.nextDay(); const { id } = await f.controller.learning.review(); await f.controller.idle();
  const l = f.controller.learning;
  assert.equal(l.status().discardedTraits.length, 1);
  l.change({ id: 'discarded-trait', operation: 'restore_trait', version: l.iteration().version });
  assert.equal(l.iteration().traits.length, 1); assert.equal(l.status().discardedTraits.length, 0);
  // A separate discarded trait stays available at exactly seven days, then expires.
  f.store.db.prepare('INSERT INTO learning_discarded VALUES(?,?,?,?)').run('expired-trait', '123', day, JSON.stringify({ id: 'expired-trait', text: '过期习惯' }));
  f.now(day + 7 * 86400000); assert.equal(l.status().discardedTraits.length, 1);
  f.now(day + 7 * 86400000 + 1); assert.equal(l.status().discardedTraits.length, 0);
  assert.throws(() => l.change({ id: 'expired-trait', operation: 'restore_trait', version: l.iteration().version }), { code: 'LEARNING_STALE' });
  assert.equal(l.iteration().traits[0].text, '重复习惯');
  assert.equal(f.store.run(id).state, 'completed');
});

test('discarded expressions expire while picked-up candidates and user bans survive with learning off', async t => {
  const f = setup(t); await f.bind(); f.enable(); await f.read('discard-expression-source');
  const l = f.controller.learning, e = l.entries()[0];
  l.change({ id: e.id, version: e.version, operation: 'stop' });
  f.now(day + 6 * 86400000);
  l.change({ id: e.id, version: l.entry(e.id).version, operation: 'restore' });
  f.now(day + 8 * 86400000); l.tick(); assert.equal(l.entry(e.id).state, 'candidate');
  l.change({ id: e.id, version: l.entry(e.id).version, operation: 'stop' });
  l.saveEntry({ ...e, id: 'user-ban', expression: '禁用短语', state: 'blocked', discardedAt: day });
  f.controller.configure({ learningEnabled: false });
  f.now(day + 16 * 86400000); l.tick();
  assert.equal(l.entry(e.id), undefined); assert.equal(l.entry('user-ban').state, 'blocked');
  assert.equal(f.store.db.prepare('SELECT COUNT(*) n FROM learning_evidence WHERE entry_id=?').get(e.id).n, 0);
});

test('review integrates expression usage and context supplies creative examples without changing the original idiom', async t => {
  const f = setup(t); await f.bind(); f.enable(); await f.read('creative-use-1'); await f.read('creative-use-2', 'BV1xx411c7mE');
  const l = f.controller.learning, e = l.entries()[0];
  l.saveEntry({ ...e, state: 'active' }); f.nextDay();
  f.response = run => ({ ...setupResponse(run), expression_decisions: [{ id: e.id, action: 'revise', reason: '整合语境与幽默机制。',
    meaning: '论据充分时的轻巧收尾', context: '核对证据后用生活类比', avoid: '悲伤场景不用', example: '这证据密度，都能给结论承重了。' }] });
  const { id } = await l.review(); await f.controller.idle(); assert.equal(f.store.run(id).state, 'completed');
  assert.equal(l.entry(e.id).expression, e.expression); assert.match(l.entry(e.id).example, /承重/);
  const snapshot = l.context('123', f.evidence); assert.match(snapshot.text, /承重/); assert.match(snapshot.text, /可改写、借用结构/);
});

test('consolidation can remove several redundant traits and expired removals cannot be rolled back', async t => {
  const f = setup(t); await f.bind(); f.enable(); await f.read('merge-trait-source');
  const l = f.controller.learning;
  f.store.set('iteration:123', { version: 1, traits: Array.from({ length: 5 }, (_, i) => ({ id: 'merge-old-' + i, text: '旧习惯' + i, reason: '旧来源', sourceIds: [] })) });
  f.response = run => ({ ...setupResponse(run), decisions: run.learningReview.iterationBefore.traits.map((old, i) => i ?
    { id: old.id, action: 'remove', reason: '整合到第一条。' } : { id: old.id, action: 'revise', text: '以具体细节作简短而风趣的类比。', reason: '合并近义习惯。', source_ids: [run.learningReview.sources[0].id] }) });
  f.nextDay(); const { id } = await l.review(); await f.controller.idle();
  assert.equal(f.store.run(id).state, 'completed'); assert.equal(l.iteration().traits.length, 1);
  assert.equal(l.status().discardedTraits.length, 4);
  f.now(day + 9 * 86400000); l.cleanupDiscarded();
  assert.throws(() => l.rollbackIteration({ reviewId: id, version: l.iteration().version }), { code: 'LEARNING_ROLLBACK' });
  assert.equal(l.iteration().traits.length, 1);
});

test('repeated discard does not postpone expiry and legacy inactive records receive one migration timestamp', async t => {
  const f = setup(t); await f.bind(); f.enable(); await f.read('repeated-stop-source');
  const l = f.controller.learning, e = l.entries()[0];
  l.saveEntry({ ...e, state: 'inactive' }); l.cleanupDiscarded(); assert.equal(l.entry(e.id).discardedAt, day);
  f.now(day + 6 * 86400000); l.cleanupDiscarded();
  l.change({ id: e.id, version: l.entry(e.id).version, operation: 'stop' });
  assert.equal(l.entry(e.id).discardedAt, day);
  f.now(day + 8 * 86400000); l.cleanupDiscarded(); assert.equal(l.entry(e.id), undefined);
});

test('integrated review writes one authoritative paragraph and uses it across context, projections and manual re-integration', async t => {
  const f = setup(t); await f.bind(); f.enable(); await f.read('profile-source');
  const l = f.controller.learning, text = '我更在意交流里真实的回应，愿意承认说到点上的提醒，也喜欢从具体细节里找一点轻巧的幽默，让认真和风趣顺着同一个意思自然接起来。';
  f.store.set('iteration:123', { version: 4, traits: [
    { id: 'old-profile-a', text: '先接住意思再补一句。', reason: '旧观察', sourceIds: ['profile-source'] },
    { id: 'old-profile-b', text: '被问住时不躲。', reason: '旧观察', sourceIds: ['profile-source'] }
  ] });
  f.response = run => ({ runId: run.id, integrated_persona: { text, reason: '把接话和认账归纳成真实坦率的交流气质。', source_ids: ['profile-source'] },
    discarded_trait_ids: [], comparison: '将旧规则融合为整体交流气质，正文不复述每日材料。', expression_decisions: [], report: '', direction: '' });
  f.nextDay(); const daily = await l.review(); await f.controller.idle();
  assert.equal(f.store.run(daily.id).state, 'completed'); assert.equal(l.iteration().profile.text, text);
  assert.match(l.context('123').text, /认真和风趣/); assert.doesNotMatch(l.context('123').text, /先接住意思再补一句|被问住时不躲|旧观察/);
  assert.equal(l.status().discardedTraits.length, 0, 'absorbed material is not discarded');
  assert.match(readFileSync(join(f.workspacePath, l.status().projection.path), 'utf8'), /认真和风趣/);
  const beforeCalls = f.counters.prompt;
  const manual = await f.controller.dispatch({ action: 'learning_integrate' }); await f.controller.idle();
  assert.notEqual(manual.id, daily.id); assert.equal(f.store.run(manual.id).state, 'completed');
  assert.equal(f.counters.prompt, beforeCalls + 1); assert.equal(l.budget().calls, 2);
  assert.equal(f.store.db.prepare('SELECT COUNT(*) n FROM learning_review_sources').get().n, 1);
  const exported = await l.archive.export({ reviewId: manual.id });
  assert.match(readFileSync(join(f.workspacePath, exported.path), 'utf8'), /认真和风趣/);
});

test('a profile is mandatory for new reviews, list text and invented profile sources are rejected atomically', async t => {
  for (const invalid of ['missing', 'list', 'source']) {
    const f = setup(t); await f.bind(); f.enable(); await f.read('invalid-profile-' + invalid); f.nextDay();
    f.response = run => ({ ...setupResponse(run), integrated_persona: invalid === 'missing' ? undefined : {
      text: invalid === 'list' ? '1. 先认账\n2. 再解释' : '愿意更坦率地交流。', reason: '尝试整合。', source_ids: [invalid === 'source' ? 'invented-source' : run.learningReview.sources[0].id] } });
    const { id } = await f.controller.learning.review(); await f.controller.idle();
    assert.equal(f.store.run(id).state, 'failed'); assert.equal(f.controller.learning.iteration().version, 0);
  }
});

test('manual integration can synthesize legacy material without new observations and respects zero budget', async t => {
  const f = setup(t); await f.bind(); f.enable(); const l = f.controller.learning; f.store.set('learningAccount', '123');
  f.store.set('iteration:123', { version: 4, traits: [{ id: 'legacy-profile', text: '旧经验', reason: '旧记录', sourceIds: ['legacy-real-source'] }] });
  f.controller.configure({ learningDailyReviewLimit: 0 });
  await assert.rejects(f.controller.dispatch({ action: 'learning_integrate' }), { code: 'LEARNING_BUDGET' });
  f.controller.configure({ learningDailyReviewLimit: 3 });
  f.response = run => ({ runId: run.id, integrated_persona: { text: '我倾向坦率而具体地回应，也愿意留一点轻松的余地。', reason: '归纳旧经验。', source_ids: ['legacy-real-source'] }, discarded_trait_ids: [],
    comparison: '将旧记录归纳成整体气质。', expression_decisions: [], report: '', direction: '' });
  const { id } = await f.controller.dispatch({ action: 'learning_integrate' }); await f.controller.idle();
  assert.equal(f.store.run(id).state, 'completed'); assert.equal(l.iteration().version, 5); assert.equal(l.budget().calls, 1);
  assert.equal(f.counters.prompt, 1);
});
