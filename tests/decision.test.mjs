import test from 'node:test';
import assert from 'node:assert/strict';
import { bvidOf, configOf, previewPrompt, previewToken, parsePreview, resultForRequest } from '../src/decision.mjs';
import { DEFAULT_CONFIG } from '../src/store.mjs';
import { BV, preview } from './fixtures.mjs';

test('short output binding maps only the exact current token and still rejects copied or foreign task ids', () => {
  const id='reply-668743a9edbd4189181ea841328209b57e90d46f', run={id};
  const evidence={text:'测试字幕原文内容足够验证。'};
  const value={...preview(id),runId:previewToken(id)};
  assert.match(value.runId,/^bili-[a-f0-9]{16}$/);
  assert.equal(parsePreview(JSON.stringify(value),run,evidence,DEFAULT_CONFIG).runId,id);
  for(const runId of ['reply-668743a9edbd4189181ea841328209b57e90e57e90d46f',previewToken('another-task'),value.runId+'a']){
    assert.throws(()=>parsePreview(JSON.stringify({...value,runId}),run,evidence,DEFAULT_CONFIG),{code:'MODEL_FORMAT'});
  }
});

test('only BV and official video URLs are accepted', () => {
  assert.equal(bvidOf(BV), BV);
  assert.equal(bvidOf('https://www.bilibili.com/video/' + BV + '?p=2'), BV);
  for (const value of ['https://evil.test/' + BV, '../../foo', 'javascript:alert(1)', 'av123']) {
    assert.throws(() => bvidOf(value), { code: 'INVALID_BVID' });
  }
});
test('settings enforce supported keys and ranges', () => {
  assert.equal(configOf({ commentMaxChars: 100 }, DEFAULT_CONFIG).commentMaxChars, 100);
  for (const input of [{ autoSend: true }, { persona: '' }, { maxContentChars: 999 },
    { commentMaxChars: NaN }, { pythonPath: 'python\nbad' }]) {
    assert.throws(() => configOf(input, DEFAULT_CONFIG), { code: 'INVALID_CONFIG' });
  }
});
test('prompt includes evidence but never account identity or credential metadata', () => {
  const prompt = previewPrompt({ id: 'request-1' }, { bvid: BV, text: '字幕', accountUid: 'secret-uid', credential: 'secret-token' }, DEFAULT_CONFIG);
  assert.ok(prompt.includes('字幕'));
  assert.ok(!prompt.includes('secret-uid') && !prompt.includes('secret-token'));
});
test('model preview requires matching request and real quoted evidence', () => {
  const data = preview('request-1'), evidence = { text: '测试字幕原文内容足够验证。' };
  assert.equal(parsePreview(JSON.stringify(data), { id: 'request-1' }, evidence, DEFAULT_CONFIG).comment, data.comment);
  for (const patch of [{ runId: 'request-2' }, { interest: 1.1 }, { evidence_quote: '并未读到的句子' },
    { should_comment: false }, { comment: 'x'.repeat(501) }]) {
    assert.throws(() => parsePreview(JSON.stringify({ ...data, ...patch }), { id: 'request-1' }, evidence, DEFAULT_CONFIG));
  }
  assert.equal(parsePreview(JSON.stringify({ ...data, should_comment: false, comment: '', evidence_quote: '' }),
    { id: 'request-1' }, evidence, DEFAULT_CONFIG).should_comment, false);
});
test('native event envelopes are correlated by rpcId and first turn boundary', () => {
  const events = [
    { seq: 1, type: 'assistant/message', data: { message: { content: [{ type: 'text', text: 'old' }] } } },
    { seq: 2, type: 'user/message', data: { source: { rpcId: 'request-1' }, turn: 4 } },
    { seq: 3, type: 'assistant/message', data: { message: { content: [{ type: 'reasoning', text: 'private' }, { type: 'text', text: 'correct' }] } } },
    { seq: 4, type: 'turn/end', data: { turn: 4 } },
    { seq: 5, type: 'assistant/message', data: { message: { content: [{ type: 'text', text: 'later' }] } } },
  ];
  assert.equal(resultForRequest(events, 'request-1').text, 'correct');
  assert.equal(resultForRequest(events.slice(0, 3), 'request-1').ended, false);
  assert.equal(resultForRequest(events, 'missing').admitted, false);
});
