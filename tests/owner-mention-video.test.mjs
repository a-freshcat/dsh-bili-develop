import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fixture, preview, BV } from './fixtures.mjs';

async function setup(t, options = {}) {
  const now = Date.parse('2026-10-25T12:00:00+08:00'), calls = [], prompts = [];
  const target = { id: '101', root: '101', uid: '789', level: 'top', text: '这段字幕的观点你怎么看？',
    mentionedUids: ['123'], bvid: BV, notificationId: '9101', at: now };
  let f;
  f = fixture(t, { now: () => now, output(text, id) {
    prompts.push(text);
    return JSON.stringify({ ...preview(id), evidence_quote: options.quote || '测试字幕原文内容', comment: '视频的论据和评论区观点有差别。' });
  }, call: async (method, p) => {
    calls.push({ method, p });
    if (options.call) { const value = await options.call(method, p); if (value !== undefined) return value; }
    if (method === 'owner_mentions') return { accountUid: '123', matches: [target] };
    if (method === 'read_video') return { ...f.evidence, ...options.evidence, bvid: p.bvid };
    if (method === 'mentioned_video_context') return { accountUid: '123', bvid: BV, target: Object.fromEntries(['id', 'root', 'uid', 'text', 'level'].map(k => [k, target[k]])),
      discussion: { comments: [{ id: '201', text: '评论区里的合成观点用于上下文回归。', likes: 1, order: 'thread',
        url: 'https://www.bilibili.com/video/' + BV + '/#reply201', truncated: false }],
      count: 1, limit: 20, maxChars: 6000, orders: ['thread'], failedOrders: [] } };
    if (method === 'comment_reply_probe' || method === 'comment_reply_publish') return { accountUid: '123', bvid: p.bvid, oid: '987', target: p.target, mentions: [], confirmed: true, receipt: '555' };
    throw new Error('Unexpected ' + method);
  } });
  await f.bind(); f.controller.social.setAccount('123');
  f.controller.configure({ ownerAccountEnabled: true, ownerAccountUid: '789', ownerCommentReplyEnabled: true,
    dailyRoundLimit: 0, dailyAnalysisLimit: 0, ...options.config });
  return { ...f, calls, prompts, target,
    async scan() { f.controller.ownerMentions.scan(); await f.controller.ownerMentions.job; },
    watched() { return f.store.list(100).filter(r => r.kind === 'video' && r.source === 'owner_mention'); } };
}

test('owner mention reads the video and related discussion into one watched record without using browsing quotas', async t => {
  const f = await setup(t); await f.scan();
  assert.equal(f.calls.filter(x => x.method === 'read_video').length, 1);
  assert.equal(f.calls.filter(x => x.method === 'mentioned_video_context').length, 1);
  assert.equal(f.watched().length, 1);
  const run = f.watched()[0];
  assert.equal(run.state, 'preview'); assert.equal(run.interactionTarget.id, '101');
  assert.equal(f.counters.prompt, 1); assert.equal(f.counters.create, 1);
  assert.match(f.prompts[0], /测试字幕原文内容/); assert.match(f.prompts[0], /评论区里的合成观点/);
  assert.match(f.prompts[0], /这段字幕的观点你怎么看/);
  assert.equal(f.store.budget(f.store.config(), Date.parse(run.createdAt)).analyses, 0);
  assert.equal(f.store.budget(f.store.config(), Date.parse(run.createdAt)).rounds, 0);
  assert.equal(f.controller.interactions.budget('123').evaluations, 1);
  assert.match(readFileSync(join(f.workspacePath, run.notePath), 'utf8'), /使用者@触发/);
});
