import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fixture, BV } from './fixtures.mjs';
import { PluginError } from '../src/errors.mjs';
import { configOf } from '../src/decision.mjs';
import { Store, DEFAULT_CONFIG } from '../src/store.mjs';
import { transcribeFallback } from '../src/audio.mjs';
import { BiliReader, pythonFor } from '../src/python.mjs';

async function setup(t, { config = {}, subtitle = false, result = {}, fail, check } = {}) {
  const f = fixture(t); await f.bind();
  f.controller.configure({ asrEnabled: true, asrModelPath: 'C:\\models\\whisper-fixture', asrMaxSeconds: 40, ...config });
  const calls = { audio: 0, checks: 0, durations: [] };
  const evidence = { ...f.evidence, cid: 123, duration: 100, ...(subtitle ? {} : { text: '', segments: [],
    coverage: 'none', skipReason: '没有字幕。' }) };
  f.controller.reader = () => ({ async call(method, params) {
    if (method === 'read_video') return evidence;
    if (method === 'audio_check') { calls.checks++; return check ? check() : { ready: true }; }
    assert.equal(method, 'transcribe_video');
    calls.audio++; calls.durations.push(params.seconds);
    if (fail) throw new PluginError('BILI_TIMEOUT', '读取超时。');
    return { ...evidence, source: 'asr', coverage: 'partial', skipReason: null, processedSeconds: params.seconds,
      processedRanges: [{ from: 0, to: params.seconds }], processor: { name: 'fixture-ASR', version: '1' },
      text: f.evidence.text, segments: f.evidence.segments, ...result };
  } });
  const run = async id => { await f.controller.start({ requestId: id, bvid: BV }); await f.controller.idle(); return f.store.run(id); };
  return { ...f, evidence, calls, run };
}

test('subtitle priority does not spend audio quota or disclose model path', async t => {
  const f = await setup(t, { subtitle: true });
  const run = await f.run('subtitle-priority');
  assert.equal(run.state, 'preview'); assert.equal(f.calls.audio + f.calls.checks, 0);
  assert.equal(f.store.audioBudget(f.store.config()).requests, 0);
});

test('ASR fallback completes the original preview and note with one video charge', async t => {
  const f = await setup(t); const run = await f.run('asr-preview-valid');
  assert.equal(run.state, 'preview'); assert.equal(run.evidence.source, 'asr');
  assert.equal(run.sessionId, f.store.get('binding').sessionId); assert.equal(f.counters.create, 1);
  assert.equal(f.store.budget(f.store.config()).analyses, 1);
  assert.equal(f.store.audioBudget(f.store.config()).reservedSeconds, 40);
  assert.equal(f.calls.audio, 1); assert.equal(run.noteStatus, 'saved');
  assert.match(readFileSync(join(f.workspacePath, run.notePath), 'utf8'), /实际处理区间.*0–40/);
  assert.match(run.promptText, /自动语音转写/); assert.match(run.promptText, /processedRanges/);
  assert.ok(!run.promptText.includes('C:\\models') && !run.promptText.includes('accountUid'));
  await f.run('asr-preview-valid'); assert.equal(f.calls.audio, 1);
});

test('audio seconds are reserved atomically and remaining budget shortens the next request', async t => {
  const f = await setup(t, { config: { dailyAudioSeconds: 55 } });
  await f.run('audio-budget-one'); await f.run('audio-budget-two');
  assert.deepEqual(f.calls.durations, [40, 15]);
  const third = await f.run('audio-budget-three');
  assert.equal(third.state, 'failed'); assert.equal(third.error.code, 'AUDIO_LIMIT');
  assert.equal(f.calls.audio, 2); assert.equal(f.store.budget(f.store.config()).analyses, 3);
  assert.equal(f.store.audioBudget(f.store.config()).reservedSeconds, 55);
});

test('disabled ASR and no reliable speech do not call the model', async t => {
  const f = await setup(t, { config: { asrEnabled: false } });
  assert.equal((await f.run('disabled-asr-test')).state, 'skipped');
  assert.equal(f.calls.audio, 0); assert.equal(f.counters.prompt, 0);
  f.controller.configure({ asrEnabled: true });
  f.controller.reader = () => ({ async call(method) {
    if (method === 'read_video') return f.evidence;
    if (method === 'audio_check') return { ready: true };
    return { ...f.evidence, source: 'asr', coverage: 'partial', text: '', segments: [], processedSeconds: 40,
      processedRanges: [{ from: 0, to: 40 }], skipReason: '未检测到可靠讲话。' };
  } });
  assert.equal((await f.run('no-speech-video')).state, 'skipped');
  assert.equal(f.counters.prompt, 0); assert.equal(f.store.audioJob('no-speech-video').state, 'completed');
});

test('timeout preserves reserved quota through database reopen', async t => {
  const f = await setup(t, { fail: true });
  const run = await f.run('audio-timeout-one');
  assert.equal(run.error.code, 'BILI_TIMEOUT'); assert.equal(f.store.audioJob(run.id).state, 'failed');
  const reopened = new Store(join(f.root, 'state.sqlite'));
  try {
    assert.equal(reopened.audioBudget(reopened.config()).reservedSeconds, 40);
    assert.throws(() => reopened.reserveAudio(run.id, 40), { code: 'AUDIO_ALREADY_ADMITTED' });
  } finally { reopened.close(); }
  assert.equal(f.counters.prompt, 0);
});

test('empty speech has no text coverage and skips the model; nonempty evidence cannot claim no coverage', async t => {
  const f = await setup(t, { result: { text: '', segments: [], coverage: 'none', skipReason: '音轨没有可靠讲话；未读取画面文字。' } });
  const run = await f.run('audio-no-text-coverage'); assert.equal(run.state, 'skipped');
  assert.equal(run.evidence.coverage, 'none'); assert.equal(f.counters.prompt, 0);
  const g = await setup(t, { result: { coverage: 'none' } });
  assert.equal((await g.run('invalid-no-coverage')).error.code, 'INVALID_EVIDENCE'); assert.equal(g.counters.prompt, 0);
});

test('mismatched account and out-of-range ASR segments never enter the original conversation', async t => {
  const f = await setup(t, { result: { accountUid: 'different-account' } });
  assert.equal((await f.run('asr-wrong-account')).error.code, 'INVALID_EVIDENCE');
  assert.equal(f.counters.prompt, 0);
  f.controller.reader = () => ({ async call(method) {
    if (method === 'read_video') return f.evidence;
    if (method === 'audio_check') return { ready: true };
    return { ...f.evidence, source: 'asr', coverage: 'partial', processedSeconds: 40,
      text: '越界内容', segments: [{ from: 39, to: 99, text: '越界内容' }] };
  } });
  assert.equal((await f.run('asr-wrong-range')).error.code, 'INVALID_EVIDENCE');
  assert.equal(f.counters.prompt, 0);
});

test('pausing before audio admission does not spend audio quota', async t => {
  let finish;
  const f = await setup(t, { check: () => new Promise(resolve => { finish = resolve; }) });
  const promise = transcribeFallback(f.controller, { id: 'pause-audio-read', roundId: 'round-fixture', bvid: BV }, f.evidence, f.store.config());
  await new Promise(resolve => setImmediate(resolve));
  f.controller.scheduler.pause(); finish({ ready: true });
  await assert.rejects(promise, { code: 'BROWSING_PAUSED' });
  assert.equal(f.calls.audio, 0); assert.equal(f.store.audioBudget(f.store.config()).requests, 0);
});

test('restart marks unfinished audio interrupted and cannot silently retry or refund it', async t => {
  const f = await setup(t);
  const binding = f.store.get('binding');
  f.store.start({ id: 'interrupted-audio', kind: 'video', bvid: BV, sessionId: binding.sessionId });
  f.store.reserveAudio('interrupted-audio', 40);
  f.store.update('interrupted-audio', { readStage: 'audio' });
  await f.controller.recover();
  assert.equal(f.store.run('interrupted-audio').state, 'interrupted');
  assert.equal(f.store.audioJob('interrupted-audio').state, 'interrupted');
  assert.equal(f.store.audioBudget(f.store.config()).requests, 1); assert.equal(f.calls.audio, 0);
});

test('audio budget zero blocks inference and invalid settings are rejected', async t => {
  const f = await setup(t, { config: { dailyAudioRequests: 0 } });
  assert.equal((await f.run('audio-zero-limit')).error.code, 'AUDIO_LIMIT'); assert.equal(f.calls.audio, 0);
  for (const patch of [{ asrEnabled: true }, { asrMaxSeconds: -1 }, { dailyAudioRequests: 501 },
    { audioTimeoutSeconds: 0 }, { asrModelPath: 'bad\npath' }])
    assert.throws(() => configOf(patch, DEFAULT_CONFIG), { code: 'INVALID_CONFIG' });
  f.controller.configure({ dailyAudioRequests: 1 });
  assert.equal(f.store.reserveAudio('short-audio-clip', 0.6).seconds, 1);
});

test('audio environment checks cannot interrupt active inference', async t => {
  const f = await setup(t);
  f.store.start({ id: 'audio-in-progress', kind: 'video', bvid: BV, sessionId: f.store.get('binding').sessionId });
  f.store.update('audio-in-progress', { readStage: 'audio' });
  for (const action of ['reader_ping', 'audio_check', 'account', 'login_start'])
    await assert.rejects(f.controller.dispatch({ action }), { code: 'RUN_BUSY' });
  assert.equal(f.calls.checks, 0);
});

test('optional dependency setup reports failure and releases its state without touching binding', async t => {
  const f = fixture(t); await f.bind(); const binding = f.store.get('binding');
  f.controller.reader = () => ({ async call(method) { return method === 'ping' ? { protocol: 1, bilibiliApi: '17.4.2' } : { dependencies: false }; } });
  f.controller.installAudio = async () => { throw new Error('fixture installation failure'); };
  await f.controller.dispatch({ action: 'install_audio' }); await f.controller.installJob;
  assert.equal(f.controller.installState.state, 'failed'); assert.equal(f.controller.installing, false);
  assert.deepEqual(f.store.get('binding'), binding);
});

test('hard audio timeout terminates a real busy worker instead of leaving inference running', async t => {
  const f = fixture(t);
  const worker = join(f.root, 'busy-worker.py');
  writeFileSync(worker, 'import sys\nfrom pathlib import Path\nfor line in sys.stdin:\n Path(__file__).with_suffix(".started").touch()\n while True:\n  pass\n');
  const reader = new BiliReader({ python: pythonFor({}, f.root, process.cwd()), worker, dataDir: f.root });
  t.after(() => reader.close());
  const result = reader.call('transcribe_video', {}, 1500);
  const child = reader.child;
  let exited = false;
  child.once('exit', () => { exited = true; });
  await assert.rejects(result, { code: 'AUDIO_TIMEOUT' });
  for (let i = 0; i < 50 && !exited; i++) await new Promise(resolve => setTimeout(resolve, 20));
  assert.ok(existsSync(join(f.root, 'busy-worker.started')), 'worker must actually enter its busy operation');
  assert.ok(exited, 'deadline must terminate the inference process');
  assert.equal(reader.child, null);
});
