import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fixture, BV } from './fixtures.mjs';

const day = Date.parse('2026-10-23T12:00:00+08:00');
async function setup(t, extra = {}) {
  const clock = { now: day }; let response;
  const f = fixture(t, { now: () => clock.now, output: (_text, id) => JSON.stringify(response(f.store.run(id))), ...extra });
  await f.bind(); f.controller.configure({ learningEnabled: true }); f.controller.social.setAccount('123');
  response = run => ({ runId: run.id, comparison: '与以往相比，新的交流建议值得先观察。', decisions: [], additions: [], expression_decisions: [], report: '', direction: '' });
  return { ...f, clock, feedback: f.controller.feedback, response: fn => { response = fn; }, record: (extra = {}) => f.controller.feedback.record({ account: '123', sender: '456', sourceId: 'reply-1', text: 'AI味太重，建议直接说重点。', scope: 'public_reply', bvid: BV, url: 'https://www.bilibili.com/video/' + BV + '/#reply123', ...extra }) };
}

test('actual feedback is an unadopted source, deduplicated daily; private raw text and identity never enter derived learning', async t => {
  const f = await setup(t); const base = f.store.config().persona;
  assert.equal(f.record(), 1); assert.equal(f.record({ sourceId: 'reply-2' }), 0);
  assert.equal(f.record({ sender: '789', scope: 'private_style', text: '这是我的私密联系方式test@example.invalid，你像机器人。', sourceId: 'dm-private-1' }), 1);
  assert.equal(f.record({ sender: '888', text: '我不觉得你AI味太重。', sourceId: 'reply-negative' }), 0);
  const rows = f.store.db.prepare('SELECT data FROM learning_observations').all().map(r => JSON.parse(r.data));
  const privateRow = rows.find(r => r.scope === 'private_style');
  assert.equal(privateRow.quote, ''); assert.equal(privateRow.url, ''); assert.doesNotMatch(JSON.stringify(privateRow), /test@example|私密联系|789|dm-private-1/);
  assert.equal(f.controller.learning.iteration().traits.length, 0); assert.equal(f.store.config().persona, base); assert.equal(f.counters.prompt, 0);
  f.controller.configure({ learningFeedbackEnabled: false }); assert.equal(f.record({ sender: '999' }), 0);
});

test('feedback-only daily comparison can propose creative experiments without adopting them or reporting, exported in the original workspace', async t => {
  const f = await setup(t); const base = f.store.config().persona; f.record();
  f.response(run => ({ runId: run.id, comparison: '和之前比较，先试更自然的短句，暂不固化。', decisions: [], additions: [], expression_decisions: [], report: '', direction: '',
    creative_ideas: [{ issue: '模板化开场有时太多。', idea: '尝试从具体观察开始。', trial: '下次用一个短句表达具体感受。', reason: '交流中有人提出了表达建议。', source_ids: [run.learningReview.sources[0].id] }] }));
  f.clock.now += 86400000; const { id } = await f.controller.learning.review(); await f.controller.idle();
  const run = f.store.run(id), review = f.controller.learning.reviews()[0];
  assert.equal(run.state, 'completed'); assert.equal(run.learningReview.stats.videos, 0); assert.equal(run.learningReview.stats.feedback, 1);
  assert.equal(review.creativeIdeas.length, 1); assert.equal(f.controller.learning.iteration().traits.length, 0); assert.equal(f.store.config().persona, base);
  assert.equal(f.counters.create, 1); assert.equal(f.counters.prompt, 1); assert.equal(f.controller.feedback.status().recent[0].includedInReview, true);
  const projection = f.controller.learning.status().projection;
  assert.ok(resolve(f.workspacePath, projection.ideasPath).startsWith(f.workspacePath)); assert.match(readFileSync(join(f.workspacePath, projection.ideasPath), 'utf8'), /从具体观察开始/);
  assert.match(f.controller.learning.archive.status().projection?.path || projection.path, /learning/);
});

test('creative proposals require current real sources and their own switch, preserving base and prior iteration on rejection', async t => {
  for (const disabled of [false, true]) {
    const f = await setup(t); f.record(); if (disabled) f.controller.configure({ learningCreativeIdeas: false });
    f.response(run => ({ runId: run.id, comparison: '先比较真实反馈。', decisions: [], additions: [], expression_decisions: [], report: '', direction: '',
      creative_ideas: [{ issue: '表达需改进', idea: '尝试变化', trial: '先小范围观察', reason: '需要依据', source_ids: [disabled ? run.learningReview.sources[0].id : 'invented-source'] }] }));
    f.clock.now += 86400000; const { id } = await f.controller.learning.review(); await f.controller.idle();
    assert.equal(f.store.run(id).state, 'failed'); assert.equal(f.controller.learning.iteration().traits.length, 0);
  }
});

test('the exact human-answer criticism is captured without copying private wording into learning', async t => {
  const f = await setup(t);
  assert.equal(f.record({ scope: 'private_style', text: '人不是这样回答的', sourceId: 'human-answer-style' }), 1);
  assert.equal(f.feedback.status().privateFeedback, 1);
  assert.equal(f.feedback.status().recent[0].code, 'less_formulaic');
  assert.equal(f.feedback.status().recent[0].quote, '');
  assert.doesNotMatch(JSON.stringify(f.feedback.status().recent), /人不是这样回答的/);
});

test('semantic suggestions require a fixed category and exact current-message evidence; no private freeform payload crosses over', async t => {
  const f = await setup(t), text = '谢谢分享，但你说的话我总要读两次才明白。私密邮箱test@example.invalid';
  const source = { scope: 'private_style', text, sourceId: 'semantic-safety' };
  assert.equal(f.record({ ...source, semantic: [{ code: 'replace_persona', evidence_quote: '谢谢分享' }, { code: 'clearer', evidence_quote: '不存在的原文' }] }), 0);
  assert.equal(f.record({ ...source, semantic: [{ code: 'clearer', evidence_quote: '读两次才明白', summary: 'test@example.invalid', url: 'https://example.invalid' }] }), 1);
  const rows = f.feedback.status().recent;
  assert.doesNotMatch(JSON.stringify(rows), /读两次才明白|test@example|example\.invalid/);
  assert.equal(rows[0].code, 'clearer'); assert.equal(rows[0].quote, '');
});

test('local private backfill is bounded, once-only, account scoped and does not send, rescore, or re-prompt', async t => {
  const f = await setup(t), contacts = f.controller.social.contacts;
  contacts.put('123', '456', { fan: true, score: 80 });
  contacts.put('123', '789', { fan: false, score: 90 });
  const put = (id, patch = {}) => contacts.saveMessage({ id, accountUid: '123', uid: '456', at: day, state: 'sent', text: '人不是这样回答的', ...patch });
  put('backfill-one'); put('backfill-two', { state: 'failed', text: '这只是另一条普通私信。' });
  put('outgoing-proactive', { kind: 'proactive' }); put('already-redacted', { state: 'redacted' }); put('unknown-person', { uid: '789' });
  put('another-account', { accountUid: '999' });
  await f.controller.dispatch({ action: 'feedback_private_scan' });
  let status = f.feedback.status(); assert.equal(status.privateConversations, 1); assert.equal(status.privateFeedback, 1);
  assert.equal(contacts.person('123', '456').score, 80); assert.equal(contacts.history('123', '456').length, 0);
  assert.equal(contacts.message('backfill-one').text, '人不是这样回答的');
  assert.equal(contacts.message('backfill-one').state, 'sent');
  assert.equal(contacts.message('outgoing-proactive').feedbackCaptureVersion, undefined);
  await f.controller.dispatch({ action: 'feedback_private_scan' }); f.clock.now += 86400000;
  await f.controller.dispatch({ action: 'feedback_private_scan' });
  assert.equal(f.feedback.status().total, 2); assert.equal(f.counters.prompt, 0); assert.equal(f.counters.read, 0);
  assert.equal(f.store.db.prepare('SELECT COUNT(*) n FROM private_attempts').get().n, 0);
  f.controller.social.setAccount('999'); status = f.feedback.status(); assert.equal(status.total, 0); assert.equal(status.recent.length, 0);
});

test('local private collection obeys learning switches and a neutral conversation is not counted as a criticism in daily review', async t => {
  const f = await setup(t), contacts = f.controller.social.contacts;
  contacts.put('123', '456', { fan: true });
  const m = contacts.saveMessage({ id: 'neutral-private', accountUid: '123', uid: '456', at: day, state: 'draft', text: '今天聊得很开心。' });
  f.controller.configure({ learningFeedbackEnabled: false });
  assert.equal(f.feedback.capturePrivate(m), 0); assert.throws(() => f.feedback.scanPrivate(), { code: 'FEEDBACK_DISABLED' });
  f.controller.configure({ learningFeedbackEnabled: true }); assert.equal(f.feedback.capturePrivate(m), 1);
  f.clock.now += 86400000; const { id } = await f.controller.learning.review(); await f.controller.idle();
  const run = f.store.run(id); assert.equal(run.state, 'completed');
  assert.equal(run.learningReview.stats.conversations, 1); assert.equal(run.learningReview.stats.feedback, 0); assert.equal(run.learningReview.stats.videos, 0);
  assert.doesNotMatch(run.promptText, /今天聊得很开心/);
  const exported = await f.controller.learning.archive.export({ reviewId: id });
  const markdown = readFileSync(join(f.workspacePath, exported.path), 'utf8');
  assert.match(markdown, /私信对话复盘线索/); assert.doesNotMatch(markdown, /公开回复的表达建议|今天聊得很开心/);
});
