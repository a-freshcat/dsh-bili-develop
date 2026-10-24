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
