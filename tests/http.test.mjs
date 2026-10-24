import test from 'node:test';
import assert from 'node:assert/strict';
import { makeHandler } from '../index.js';
import { fixture } from './fixtures.mjs';
test('settings API requires JSON and same-origin; errors do not expose internals', async t => {
  const f = fixture(t);
  const handler = makeHandler(f.controller);
  const request = (body, headers = {}, method = 'POST') => new Request('http://localhost/api/bilibili-harness', {
    method, headers: { 'content-type': 'application/json', ...headers },
    ...(method === 'POST' ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}),
  });
  assert.equal((await handler(request({ action: 'status' }))).status, 200);
  assert.equal((await handler(request({}, { origin: 'https://evil.test' }))).status, 403);
  assert.equal((await handler(request({}, { 'content-type': 'text/plain' }))).status, 415);
  assert.equal((await handler(request('bad-json'))).status, 400);
  assert.equal((await handler(request({}, {}, 'GET'))).status, 405);
  assert.equal((await handler(request(' '.repeat(65537)))).status, 413);
  assert.equal((await handler(request({ action: 'send_comment' }))).status, 404);
});

test('settings reports a larger compaction summary without the generic environment error', async t => {
  const f = fixture(t); await f.bind();
  f.ctx.compaction = { async compactNow() {
    const error = new Error('manual compaction could not produce a smaller summary', {
      cause: new Error('summary is not smaller than the shadowed content (986 estimated framed tokens >= 685)'),
    });
    error.name = 'ManualCompactionError'; error.code = 'summary'; throw error;
  } };
  const response = await makeHandler(f.controller)(new Request('http://localhost/api/bilibili-harness', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'compact' }),
  }));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.value.compacted, false);
  assert.equal(body.value.outcome, 'summary_not_smaller');
  assert.doesNotMatch(body.value.message, /读取环境|操作未完成/);
});

test('round controls are wired through the authenticated settings API', async t => {
  const f = fixture(t); await f.bind();
  f.controller.configure({ keywords: ['测试'] });
  f.controller.reader = () => ({ async call(method) {
    if (method === 'account') return { status: 'logged_in', uid: '123' };
    if (method === 'search_videos') return { videos: [{ bvid: f.evidence.bvid }] };
    return f.evidence;
  } });
  const handler = makeHandler(f.controller);
  const invoke = async input => (await handler(new Request('http://localhost/api/bilibili-harness', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input),
  }))).json();
  assert.equal((await invoke({ action: 'run_now', requestId: 'http-round-control' })).ok, true);
  await new Promise(resolve => setImmediate(resolve));
  await invoke({ action: 'pause_browsing' });
  assert.equal((await invoke({ action: 'status' })).value.browsing.paused, true);
  await invoke({ action: 'resume_browsing' });
  for (let i = 0; i < 4; i++) {
    await new Promise(resolve => setImmediate(resolve));
    await f.controller.scheduler.tick(); await f.controller.idle();
  }
  const result = (await invoke({ action: 'status' })).value;
  assert.equal(result.browsing.budget.analyses, 1);
  assert.equal(result.browsing.budget.rounds, 1);
  assert.equal(result.runs[0].state, 'preview');
  assert.equal(result.runs[0].source, 'immediate');
});
