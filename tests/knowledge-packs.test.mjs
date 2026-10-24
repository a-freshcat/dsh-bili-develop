import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, BV } from './fixtures.mjs';
import { DEFAULT_CONFIG } from '../src/store.mjs';
import { configOf } from '../src/decision.mjs';
import { knowledgeCatalogue, knowledgeInstruction, knowledgePolicy, knowledgePolicyParts } from '../src/knowledge-packs.mjs';
import { settingsHarness, flatten, nodeText } from './settings-harness.mjs';
const PACK = 'natural-short-zh';
const marker = '【可选知识包：自然中文短回复】';

test('knowledge package is opt-in, schema rejects unknown instructions, and selection alone does not mutate persona or iteration', async t => {
  assert.deepEqual(DEFAULT_CONFIG.learningKnowledgePacks, []); assert.equal(knowledgeCatalogue(DEFAULT_CONFIG)[0].active, false);
  for (const value of [null, 'natural-short-zh', ['https://external.test/SKILL.md'], [PACK, PACK], [{ id: PACK }]])
    assert.throws(() => configOf({ learningKnowledgePacks: value }, DEFAULT_CONFIG), { code: 'INVALID_CONFIG' });
  const f = fixture(t); await f.bind(); const persona = f.store.config().persona;
  f.controller.configure({ learningKnowledgePacks: [PACK] });
  assert.equal(f.store.config().persona, persona); assert.deepEqual(f.controller.learning.iteration().traits, []);
  assert.equal(f.counters.prompt, 0); assert.equal(f.counters.read, 0);
  assert.equal(knowledgeCatalogue(f.store.config())[0].selected, true); assert.equal(knowledgeCatalogue(f.store.config())[0].active, false);
  assert.ok(!knowledgeInstruction(f.store.config()).includes(marker)); assert.equal(knowledgePolicy(f.store.config()), '');
  assert.deepEqual(knowledgePolicyParts(f.store.config()), [], 'unloaded policy keeps old draft hashes compatible');
});

test('enabled package reaches the sole model turn with persona, truth and JSON boundaries, and unloading stops its text', async t => {
  const f = fixture(t); await f.bind();
  f.controller.configure({ learningEnabled: true, learningKnowledgePacks: [PACK], persona: '保持正式，必要时写完整长句，不使用撒娇口吻。' });
  await f.controller.start({ requestId: 'knowledge-video-on', bvid: BV }); await f.controller.idle();
  const run = f.store.run('knowledge-video-on'); assert.equal(run.state, 'preview'); assert.ok(run.promptText.includes(marker));
  assert.match(run.promptText, /有冲突就舍弃建议/); assert.match(run.promptText, /JSON外壳/); assert.match(run.promptText, /不得假装真人/);
  assert.match(run.promptText, /保持正式，必要时写完整长句/);
  assert.deepEqual(run.learningSnapshot.knowledgePacks, [{ id: PACK, version: '1.0.0' }]);
  assert.equal(f.counters.create, 1); assert.equal(f.counters.prompt, 1); assert.equal(f.controller.learning.entries().length, 0);
  f.controller.configure({ learningKnowledgePacks: [] });
  await f.controller.start({ requestId: 'knowledge-video-off', bvid: BV }); await f.controller.idle();
  assert.ok(!f.store.run('knowledge-video-off').promptText.includes(marker));
  assert.match(f.store.run('knowledge-video-off').promptText, /历史知识包文字不作为当前约束/);
  assert.deepEqual(f.store.run('knowledge-video-off').learningSnapshot.knowledgePacks, []);
  assert.equal(f.counters.prompt, 2); assert.equal(f.store.config().persona, '保持正式，必要时写完整长句，不使用撒娇口吻。');
});

test('package settings change invalidates unsent comment drafts without any platform POST', async t => {
  const f = fixture(t); await f.bind(); f.controller.configure({ learningEnabled: true, learningKnowledgePacks: [PACK], commentMode: 'manual' });
  await f.controller.start({ requestId: 'knowledge-draft-stale', bvid: BV }); await f.controller.idle();
  const d = f.controller.comments.get('knowledge-draft-stale'); f.controller.configure({ learningKnowledgePacks: [] });
  await assert.rejects(f.controller.comments.send(d.id, d.revision), { code: 'COMMENT_STALE' }); assert.equal(f.counters.read, 1);
});

test('knowledge package UI starts collapsed and unloaded, saves explicitly and can return to independent cultivation without model calls', async t => {
  const f = fixture(t); await f.bind(); f.controller.configure({ learningEnabled: true });
  const ui = await settingsHarness(f.controller); t.after(ui.close);
  let tree = ui.render(); ui.button(tree, '人设').props.onClick(); tree = ui.render();
  const nav = flatten(tree).find(n => n?.props?.['aria-label'] === '人设分区'); ui.button(nav, '设置').props.onClick(); tree = ui.render();
  const packageSection = () => flatten(tree).find(n => n?.props?.className === 'knowledge-packs');
  assert.ok(!packageSection().props.open); assert.match(nodeText(packageSection()), /默认不加载/);
  const toggle = () => flatten(packageSection()).find(n => n?.type === 'input' && n.props.type === 'checkbox');
  assert.equal(toggle().props.checked, false); toggle().props.onChange({ target: { checked: true } }); tree = ui.render();
  assert.deepEqual(f.store.config().learningKnowledgePacks, [], 'checkbox is not applied before save');
  await ui.button(tree, '保存学习设置').props.onClick(); await ui.flush(); tree = ui.render();
  assert.deepEqual(f.store.config().learningKnowledgePacks, [PACK]); assert.match(nodeText(packageSection()), /已保存状态：已加载/);
  toggle().props.onChange({ target: { checked: false } }); tree = ui.render(); await ui.button(tree, '保存学习设置').props.onClick(); await ui.flush();
  assert.deepEqual(f.store.config().learningKnowledgePacks, []); assert.equal(f.counters.prompt, 0); assert.equal(f.counters.read, 0);
});
