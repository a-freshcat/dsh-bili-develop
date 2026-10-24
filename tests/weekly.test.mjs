import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fixture } from './fixtures.mjs';
import { digest, managed } from '../src/weekly-assets.mjs';
import { Weekly } from '../src/weekly.mjs';
import { makeHandler } from '../index.js';
import { PluginError } from '../src/errors.mjs';

const NOW = Date.parse('2026-10-23T12:00:00Z');
async function setup(t, options = {}) {
  const calls = []; let uid = '123', failure, cardFailure = options.cardError, verification = {};
  const f = fixture(t, { now: () => NOW,
    output(text, runId) {
      const sources = JSON.parse(text.split('<public_materials>\n')[1].split('\n</public_materials>')[0]);
      return JSON.stringify({ runId, text: '本周读到一些有意思的内容，这份记录来自字幕与评论区样本。', source_ids: sources.map(s => s.id),
        evidence: sources.map(s => ({ id: s.id, quote: s.text.slice(0, 8) })), image_brief: '选择一张你认可的配图。', ...options.output });
    },
    call: async (method, params) => {
      calls.push({ method, params });
      if (method === 'account') return { status: 'logged_in', uid };
      if (method === 'weekly_probe') return { accountUid: uid, mentions: params.mentions };
      if (method === 'weekly_verify') return { accountUid: uid, source: 'own_space', status: 'not_in_sample', confirmed: false, receipt: '', sampleCount: 5, matchCount: 0, ...verification };
      if (method === 'weekly_publish') { if (failure) throw failure; return { accountUid: uid, accepted: true, receipt: '987654321' }; }
      if (method === 'weekly_image' || method === 'weekly_card') {
        if (method === 'weekly_card' && cardFailure) throw new Error('local card unavailable');
        const raw = method === 'weekly_card' ? Buffer.from('mock-card:' + params.body) : Buffer.from(params.base64, 'base64'), hash = digest(raw);
        writeFileSync(join(managed(f.root, ['.bilibili-harness', 'weekly', 'images']), hash + '.jpg'), raw);
        return { hash, mime: 'image/jpeg', size: raw.length, width: 32, height: 20, thumbnail: 'data:image/jpeg;base64,' + raw.toString('base64') };
      }
      throw new Error('Unexpected boundary: ' + method);
    }, ...options.fixture });
  await f.bind();
  f.controller.configure({ weeklyAutoImage: false, ...options.config });
  for (let i = 0; i < (options.count ?? 3); i++) {
    const id = 'weekly-source-' + i;
    f.store.start({ id, kind: 'video', bvid: 'BV' + String(i).padStart(10, '0'), sessionId: f.store.get('binding').sessionId, accountUid: '123', now: NOW - 10000 - i });
    f.store.update(id, { state: 'preview', evidence: { title: '公开材料' + i, source: i === 2 ? 'comments' : 'subtitle', text: '实际读取的公开原文，作为本周总结依据。' }, preview: { summary: '公开摘要', evaluation: '公开评价' } });
  }
  const w = f.controller.weekly;
  const generate = async () => { await w.generate(); await Promise.all(f.controller.jobs.values()); return w.list()[0]; };
  const attach = async (d, raw = 'mock-normalized-image') => {
    await w.images({ action: 'weekly_attach_image', id: d.id, revision: d.revision, base64: Buffer.from(raw).toString('base64') }); return w.get(d.id);
  };
  return { ...f, w, calls, generate, attach, account(value) { uid = value; }, fail(error) { failure = error; }, failCard(value) { cardFailure = value; }, verification(value) { verification = value; } };
}
const fields = d => ({ id: d.id, revision: d.revision });
const approve = (f, d) => f.w.approve({ ...fields(d), reviewed: true });
const publish = (f, d) => f.w.publish({ ...fields(d), confirmed: true });

test('upload-stage failures distinguish not-submitted from unknown while retaining once-per-week attempts', async t => {
  const f = await setup(t); let d = await f.attach(await f.generate()); await approve(f, d);
  f.fail(new PluginError('WEEKLY_UPLOAD_FAILED', '配图上传阶段未完成（PermissionError）；动态未提交。'));
  await publish(f, f.w.get(d.id)); d = f.w.get(d.id);
  assert.equal(d.state, 'not_submitted'); assert.equal(d.publishError.code, 'WEEKLY_UPLOAD_FAILED');
  assert.equal(f.w.budget().publications, 1); await assert.rejects(publish(f, d), /审核/);
  assert.equal(f.calls.filter(c => c.method === 'weekly_publish').length, 1);
});

test('readonly verification preserves unknown on absence then matches the same account without another publish or quota change', async t => {
  const f = await setup(t); let d = await f.attach(await f.generate()); await approve(f, d);
  f.fail(new PluginError('WEEKLY_UNKNOWN', '动态提交结果未确认。'));
  await publish(f, f.w.get(d.id));
  const missing = await f.controller.dispatch({ action: 'weekly_verify', id: d.id });
  assert.match(missing.message, /5条/); assert.equal(f.w.get(d.id).state, 'unknown');
  f.verification({ status: 'found', confirmed: true, receipt: '987654321', matchCount: 1 });
  await f.controller.dispatch({ action: 'weekly_verify', id: d.id }); d = f.w.get(d.id);
  assert.equal(d.state, 'accepted'); assert.equal(d.confirmationSource, 'own_space'); assert.equal(d.receipt, '987654321');
  assert.match(d.reason, /找到唯一图文匹配/); assert.doesNotMatch(d.reason, /未确认/);
  assert.equal(f.w.budget().publications, 1); assert.equal(f.calls.filter(c => c.method === 'weekly_publish').length, 1);
  assert.equal(f.calls.filter(c => c.method === 'weekly_verify').length, 2);
  assert.equal(f.calls.find(c => c.method === 'weekly_verify').params.attempt_at, NOW);
  const reopened = new Weekly(f.controller); assert.equal(reopened.get(d.id).verification.status, 'found');
});

test('readonly verification refuses wrong account, malformed success and no attempted draft without changing any state', async t => {
  const f = await setup(t); let d = await f.attach(await f.generate());
  await assert.rejects(f.controller.dispatch({ action: 'weekly_verify', id: d.id }));
  await approve(f, d); f.fail(new PluginError('WEEKLY_UNKNOWN', '未知')); await publish(f, f.w.get(d.id));
  for (const result of [{ accountUid: '999' }, { confirmed: true }, { status: 'found', confirmed: true, receipt: '1', matchCount: 2 }]) {
    f.verification(result); await assert.rejects(f.controller.dispatch({ action: 'weekly_verify', id: d.id }));
    assert.equal(f.w.get(d.id).state, 'unknown');
  }
  assert.equal(f.w.budget().publications, 1); assert.equal(f.calls.filter(c => c.method === 'weekly_publish').length, 1);
});

test('weekly draft uses public videos and the one bound native conversation; images remain local until approval and explicit send', async t => {
  const f = await setup(t); const d = await f.generate();
  assert.equal(d.state, 'draft'); assert.equal(f.counters.create, 1); assert.equal(f.counters.prompt, 1);
  assert.equal(f.store.count(), 3, 'weekly tasks are not browser-history videos');
  assert.equal(d.sources.length, 3); assert.equal(f.w.status().drafts[0].sources[0].text, undefined);
  await assert.rejects(publish(f, d), /审核/);
  let withImage = await f.attach(d);
  assert.ok(readFileSync(join(f.workspacePath, '.bilibili-harness', 'weekly', 'images', withImage.images[0].hash + '.jpg')));
  assert.equal(f.calls.filter(c => c.method === 'weekly_publish').length, 0);
  await approve(f, withImage); withImage = f.w.get(d.id);
  assert.equal(withImage.state, 'approved');
  assert.equal(f.calls.filter(c => c.method === 'weekly_publish').length, 0);
  await publish(f, withImage); assert.equal(f.w.get(d.id).state, 'accepted');
  assert.equal(f.calls.filter(c => c.method === 'weekly_publish').length, 1);
  const payload = f.calls.find(c => c.method === 'weekly_publish').params;
  assert.equal(payload.workspace, f.store.get('binding').path); assert.equal(payload.expected_account, '123');
  await assert.rejects(publish(f, withImage), /审核/); await assert.rejects(f.w.generate(), /本周/);
});

test('source gate and malformed model quotes consume no extra model retries or public sends', async t => {
  const f = await setup(t, { count: 2 });
  await assert.rejects(f.w.generate(), /至少需要3个/); assert.equal(f.counters.prompt, 0); assert.equal(f.w.budget().generations, 0);
  f.controller.configure({ weeklyMinSources: 2, weeklyDailyDraftLimit: 1 });
  let d = await f.generate(); assert.equal(d.state, 'draft');
  await assert.rejects(f.w.generate(), /当天/); assert.equal(f.counters.prompt, 1);
  const g = await setup(t, { output: { evidence: [{ id: 'weekly-source-0', quote: '这是杜撰的原文' }] } });
  d = await g.generate(); assert.equal(d.state, 'failed'); assert.match(d.reason, /引用/);
  assert.equal(g.calls.filter(c => c.method === 'weekly_publish').length, 0);
});

test('body, mentions and image order edits revoke approval; old revisions cannot publish', async t => {
  const f = await setup(t);
  f.controller.configure({ mentionTargets: [{ uid: '456', name: '测试对象', enabled: true, allowComment: true, allowDynamic: true }] });
  let d = await f.attach(await f.generate()); d = await f.attach(d, 'second-image');
  await approve(f, d); const approved = f.w.get(d.id);
  await f.w.edit({ ...fields(approved), body: '用户修改后的正文。', mentionUids: ['456'] });
  d = f.w.get(d.id); assert.equal(d.approval, null); assert.notEqual(d.revision, approved.revision);
  await assert.rejects(publish(f, approved), /审核/);
  await approve(f, d); const before = f.w.get(d.id);
  await f.w.images({ ...fields(before), action: 'weekly_images', hashes: d.images.map(i => i.hash).reverse() });
  d = f.w.get(d.id); assert.equal(d.approval, null); assert.notEqual(d.revision, before.revision);
  await assert.rejects(publish(f, before), /审核/);
  assert.equal(f.calls.filter(c => c.method === 'weekly_publish').length, 0);
});

test('replacing an approved image at the same path revokes review before any publishing call', async t => {
  const f = await setup(t); let d = await f.attach(await f.generate()); await approve(f, d); d = f.w.get(d.id);
  writeFileSync(join(f.workspacePath, '.bilibili-harness', 'weekly', 'images', d.images[0].hash + '.jpg'), Buffer.from('replaced-image-content'));
  await assert.rejects(publish(f, d), /配图/);
  assert.equal(f.w.get(d.id).approval, null); assert.equal(f.calls.filter(c => c.method === 'weekly_publish').length, 0);
});

test('deleted evidence, switched account, changed persona or binding invalidate review', async t => {
  for (const change of [f => f.account('999'), f => f.controller.configure({ persona: '新的基础人设。' }),
    f => f.store.update('weekly-source-0', { evidence: { title: '改变了', text: '别的原文', source: 'subtitle' } }),
    f => f.store.set('binding', { ...f.store.get('binding'), path: f.root })]) {
    const f = await setup(t); let d = await f.attach(await f.generate()); await approve(f, d); d = f.w.get(d.id); change(f);
    await assert.rejects(publish(f, d)); assert.equal(f.w.get(d.id).approval, null);
    assert.equal(f.calls.filter(c => c.method === 'weekly_publish').length, 0);
  }
});

test('unknown publication keeps a durable once-per-week ledger through reopening and clearing', async t => {
  const f = await setup(t); let d = await f.attach(await f.generate()); await approve(f, d); d = f.w.get(d.id);
  f.fail(new Error('simulated timeout')); await publish(f, d);
  assert.equal(f.w.get(d.id).state, 'unknown'); assert.equal(f.w.budget().publications, 1);
  f.w.save({ ...f.w.get(d.id), state: 'sending' });
  const reopened = new Weekly(f.controller); assert.equal(reopened.get(d.id).state, 'unknown'); assert.equal(reopened.budget().publications, 1);
  await f.w.discard(fields(f.w.get(d.id))); await assert.rejects(f.w.generate(), /本周已尝试/);
  assert.equal(f.calls.filter(c => c.method === 'weekly_publish').length, 1);
});

test('weekly settings, auto-draft and zero publication budget never authorize an automatic POST', async t => {
  const f = await setup(t); f.store.set('socialAccount', '123');
  await f.w.tick(); assert.equal(f.counters.prompt, 0);
  f.controller.configure({ weeklyAutoDraft: true, weeklyDay: 5, weeklyTime: '19:00', weeklyDailyPublishLimit: 0 });
  await f.w.tick(); await Promise.all(f.controller.jobs.values());
  assert.equal(f.counters.prompt, 1); await f.w.tick(); assert.equal(f.counters.prompt, 1);
  let d = await f.attach(f.w.list()[0]); await approve(f, d); d = f.w.get(d.id);
  await assert.rejects(publish(f, d), /当天动态发布/); assert.equal(f.w.budget().publications, 0);
  assert.equal(f.calls.filter(c => c.method === 'weekly_publish').length, 0);
});

test('image request size exception is limited to the authenticated attachment action', async t => {
  const f = await setup(t); const handler = makeHandler(f.controller), big = 'A'.repeat(70000);
  const call = body => handler(new Request('http://localhost/api/bilibili-harness', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }));
  assert.equal((await call({ action: 'configure', config: { persona: big } })).status, 413);
  assert.notEqual((await call({ action: 'weekly_attach_image', id: 'missing', base64: big })).status, 413);
  assert.equal(f.calls.length, 0);
});

test('automatic local card finishes the original model job, stays local, and follows body edits without another prompt', async t => {
  const f = await setup(t, { config: { weeklyAutoImage: true } }); let d = await f.generate();
  assert.equal(d.cardState, 'ready'); assert.equal(d.images.length, 1); assert.equal(d.images[0].kind, 'card');
  assert.equal(d.images[0].bodyHash, digest(d.body)); assert.equal(f.counters.prompt, 1);
  assert.equal(existsSync(join(f.root, '.bilibili-harness', 'weekly', 'images', d.images[0].hash + '.jpg')), false, 'staging copy is released');
  await approve(f, d); const reviewed = f.w.get(d.id);
  await f.w.edit({ ...fields(reviewed), body: '修改后的公开周记正文。', mentionUids: [] });
  d = f.w.get(d.id); assert.equal(d.approval, null); assert.notEqual(d.images[0].hash, reviewed.images[0].hash);
  await assert.rejects(publish(f, reviewed), /审核/); assert.equal(f.counters.prompt, 1);
  assert.equal(f.calls.filter(c => c.method === 'weekly_publish').length, 0);
});

test('a failed local card keeps the completed body and can retry without a model or platform POST', async t => {
  const f = await setup(t, { config: { weeklyAutoImage: true }, cardError: true }); let d = await f.generate();
  assert.equal(d.cardState, 'failed'); assert.ok(d.body); assert.equal(f.store.run(d.runId).state, 'completed');
  f.failCard(false); await f.w.card(fields(d)); d = f.w.get(d.id);
  assert.equal(d.cardState, 'ready'); assert.equal(f.counters.prompt, 1);
  assert.equal(f.calls.filter(c => c.method === 'weekly_publish').length, 0);
});

test('recovery of a pending local card never resubmits the durable native model result', async t => {
  const f = await setup(t); let d = await f.generate();
  f.w.save({ ...d, cardState: 'pending' }); f.store.update(d.runId, { state: 'saving' });
  await f.controller.recover(); d = f.w.get(d.id);
  assert.equal(d.cardState, 'ready'); assert.equal(f.store.run(d.runId).state, 'completed'); assert.equal(f.counters.prompt, 1);
});

test('discard and garbage collection retain shared images, receipts, changed files and unrelated documents', async t => {
  const f = await setup(t); const d = await f.attach(await f.generate());
  const shared = { ...d, id: 'weekly-' + 'b'.repeat(32), accountUid: '456' }; f.w.save(shared);
  const image = join(f.workspacePath, '.bilibili-harness', 'weekly', 'images', d.images[0].hash + '.jpg');
  const directory = managed(f.workspacePath, ['.bilibili-harness', 'weekly', 'images']);
  writeFileSync(join(directory, 'user-document.txt'), 'keep');
  writeFileSync(join(directory, 'c'.repeat(64) + '.jpg'), 'user-replaced-content');
  await f.w.discard(fields(d)); assert.equal(existsSync(image), true, 'another draft still owns this image');
  await f.w.discard(fields(shared)); assert.equal(existsSync(image), false);
  assert.equal(readFileSync(join(directory, 'user-document.txt'), 'utf8'), 'keep');
  assert.equal(readFileSync(join(directory, 'c'.repeat(64) + '.jpg'), 'utf8'), 'user-replaced-content');
});

test('all older drafts can be paged and an old in-flight publication recovers beyond the first twenty', async t => {
  const f = await setup(t); const first = await f.generate(); f.w.save({ ...first, state: 'sending' });
  for (let i = 1; i <= 25; i++) f.w.save({ ...first, id: 'weekly-' + String(i).padStart(32, '0'), accountUid: String(123 + i) });
  assert.equal(f.w.status().total, 26); assert.equal(f.w.status().drafts.length, 5);
  assert.equal(f.w.status(25).drafts[0].id, first.id);
  const restarted = new Weekly(f.controller); assert.equal(restarted.get(first.id).state, 'unknown');
  assert.equal(f.counters.prompt, 1);
});

test('automatic comment, DM, learning and browser timers wait while local weekly operations hold admission', async t => {
  const f = await setup(t);
  f.controller.configure({ commentMode: 'auto', autoEnabled: true, keywords: ['topic'], dmEnabled: true, learningEnabled: true,
    activityStart: '00:00', activityEnd: '24:00' });
  f.store.set('learningAccount', '123'); f.store.set('dmNextPoll', 0); f.store.set('nextRunAt', 0);
  f.controller.comments.stage = () => { throw new Error('must not stage'); };
  f.w.busy = true;
  assert.doesNotThrow(() => f.controller.comments.tick()); assert.doesNotThrow(() => f.controller.social.tick());
  assert.doesNotThrow(() => f.controller.learning.tick()); await f.controller.scheduler.tick();
  assert.equal(f.calls.length, 0); assert.equal(f.counters.prompt, 0);
  assert.equal(f.controller.scheduler.status().schedule.code, 'busy'); f.w.busy = false;
});
