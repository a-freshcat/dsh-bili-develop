import test from 'node:test';
import assert from 'node:assert/strict';
import { BiliReader } from '../src/python.mjs';

test('owner mention discussion read passes the real adapter gate and preserves its account and target', async () => {
  const reader = new BiliReader({}), sent = [];
  reader.start = () => {
    reader.child = { stdin: { write(line) {
      const request = JSON.parse(line); sent.push(request);
      const item = reader.pending.get(request.id);
      clearTimeout(item.timer); reader.pending.delete(request.id);
      item.resolve({ accountUid: request.params.expected_account, target: request.params.target, discussion: { comments: [] } });
    } } };
  };
  const params = { bvid: 'BV1QG5Dz7Etm', expected_account: '123', target: { id: '101', root: '101', uid: '789', level: 'top', text: '@测试账号' } };
  const result = await reader.call('mentioned_video_context', params);
  assert.equal(sent.length, 1); assert.equal(sent[0].method, 'mentioned_video_context');
  assert.deepEqual(sent[0].params, params); assert.equal(result.accountUid, '123');
  assert.deepEqual(result.target, params.target); assert.equal(reader.pending.size, 0);
});

test('unknown adapter operations still fail before starting a worker', async () => {
  const reader = new BiliReader({}); let starts = 0;
  reader.start = () => { starts++; };
  await assert.rejects(reader.call('unsupported_operation'), { code: 'READ_ONLY' });
  assert.equal(starts, 0); assert.equal(reader.pending.size, 0);
});

test('frame environment, sampling and cache cleanup operations all pass the actual adapter gate', async () => {
  const reader = new BiliReader({}), sent = [];
  reader.start = () => {
    reader.child = { stdin: { write(line) {
      const request = JSON.parse(line); sent.push(request);
      const item = reader.pending.get(request.id);
      clearTimeout(item.timer); reader.pending.delete(request.id); item.resolve({ method: request.method });
    } } };
  };
  for (const method of ['vision_check', 'sample_frames', 'vision_cleanup']) {
    assert.equal((await reader.call(method)).method, method);
  }
  assert.deepEqual(sent.map(r => r.method), ['vision_check', 'sample_frames', 'vision_cleanup']);
  assert.equal(reader.pending.size, 0);
});
