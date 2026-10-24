import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fixture, BV } from './fixtures.mjs';
import { downloadWhisperModel, pythonFor } from '../src/python.mjs';

function audioReady(f) {
  f.controller.reader = () => ({ async call(method) {
    if (method === 'ping') return { protocol: 1, bilibiliApi: '17.4.2' };
    assert.equal(method, 'audio_check'); return { dependencies: true, ready: false };
  } });
}
const result = root => ({ model: 'tiny', path: join(root, 'fixture-model'), revision: 'a'.repeat(40) });

test('model preparation is explicit, background, saves only its fields and preserves the original session', async t => {
  const f = fixture(t); await f.bind(); audioReady(f);
  const binding = f.store.get('binding');
  let complete;
  f.controller.downloadModel = options => new Promise(resolve => {
    options.onProgress({ stage: 'downloading_model', downloadedBytes: 5, totalBytes: 10 }); complete = resolve;
  });
  const initial = await f.controller.dispatch({ action: 'prepare_asr_model', model: 'tiny', source: 'official' });
  assert.equal(initial.state, 'installing');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal((await f.controller.status()).install.downloadedBytes, 5);
  await assert.rejects(f.controller.start({ requestId: 'blocked-model-setup', bvid: BV }), { code: 'INSTALL_BUSY' });
  complete(result(f.root)); await f.controller.installJob;
  assert.equal(f.controller.installState.state, 'ready');
  assert.equal(f.store.config().asrModelPath, result(f.root).path);
  assert.equal(f.store.config().asrEnabled, false);
  await f.controller.dispatch({ action: 'reader_ping' });
  assert.equal((await f.controller.status()).audio.preparedModel.path, result(f.root).path);
  assert.deepEqual(f.store.get('binding'), binding);
  assert.equal(f.store.count(), 0); assert.equal(f.counters.prompt, 0);
});

test('failed preparation keeps the prior model and reports a safe retryable result', async t => {
  const f = fixture(t); audioReady(f);
  f.controller.configure({ asrModelPath: 'C:\\existing\\model', asrEnabled: true });
  const config = f.store.config();
  f.controller.downloadModel = async () => { throw new Error('private path or token'); };
  await f.controller.dispatch({ action: 'prepare_asr_model', model: 'tiny', source: 'official' });
  await f.controller.installJob;
  assert.equal(f.controller.installing, false); assert.equal(f.controller.installState.state, 'failed');
  assert.deepEqual(f.store.config(), config);
  assert.ok(!JSON.stringify(f.controller.installState).includes('private path'));
});

test('cancellation keeps admission locked until completion and cannot install a late result', async t => {
  const f = fixture(t); audioReady(f);
  let complete;
  f.controller.downloadModel = () => new Promise(resolve => { complete = resolve; });
  await f.controller.dispatch({ action: 'prepare_asr_model', model: 'tiny', source: 'official' });
  await new Promise(resolve => setImmediate(resolve));
  await f.controller.dispatch({ action: 'cancel_asr_model' });
  assert.equal(f.controller.installing, true);
  complete(result(f.root)); await f.controller.installJob;
  assert.equal(f.controller.installState.state, 'cancelled');
  assert.equal(f.store.config().asrModelPath, ''); assert.equal(f.controller.installing, false);
});

test('model runner validates a real subprocess result and filters progress metadata', async t => {
  const f = fixture(t);
  const script = join(f.root, 'model-worker.py');
  writeFileSync(script, 'import argparse,json\nfrom pathlib import Path\np=argparse.ArgumentParser()\np.add_argument("--root")\np.add_argument("--model")\np.add_argument("--source")\na=p.parse_args()\nd=Path(a.root)/"fixture-model"\nd.mkdir()\nfor name in ("model.bin","config.json","tokenizer.json"):\n (d/name).write_text("fixture")\nprint(json.dumps({"stage":"downloading_model","downloadedBytes":1,"totalBytes":3,"secret":"must-not-appear"}),flush=True)\nprint(json.dumps({"ok":True,"result":{"path":str(d),"model":a.model,"revision":"a"*40}}),flush=True)\n');
  const progress = [];
  const r = await downloadWhisperModel({ python: pythonFor({}, f.root, process.cwd()), script, modelsDir: join(f.root, 'models'),
    model: 'tiny', source: 'official', onProgress: value => progress.push(value) });
  assert.equal(r.model, 'tiny'); assert.equal(progress.length, 1);
  assert.deepEqual(Object.keys(progress[0]).sort(), ['downloadedBytes', 'stage', 'totalBytes']);
});

test('cancelling the real setup subprocess waits for it to exit', async t => {
  const f = fixture(t);
  const script = join(f.root, 'busy-model.py');
  writeFileSync(script, 'import os,time\nfrom pathlib import Path\nPath(__file__).with_suffix(".started").write_text(str(os.getpid()))\nwhile True:\n time.sleep(1)\n');
  const abort = new AbortController();
  const promise = downloadWhisperModel({ python: pythonFor({}, f.root, process.cwd()), script, modelsDir: join(f.root, 'models'),
    model: 'tiny', source: 'official', signal: abort.signal });
  const started = join(f.root, 'busy-model.started');
  for (let i = 0; i < 100 && !existsSync(started); i++) await new Promise(resolve => setTimeout(resolve, 20));
  assert.ok(existsSync(started));
  const pid = Number(readFileSync(started, 'utf8'));
  abort.abort(); await assert.rejects(promise, { code: 'INSTALL_CANCELLED' });
  assert.throws(() => process.kill(pid, 0));
});

test('unknown models and sources cannot invoke arbitrary repositories or URLs', async t => {
  const f = fixture(t);
  await assert.rejects(f.controller.dispatch({ action: 'prepare_asr_model', model: 'owner/repo', source: 'official' }), { code: 'MODEL_INPUT' });
  await assert.rejects(f.controller.dispatch({ action: 'prepare_asr_model', model: 'tiny', source: 'https://evil.test' }), { code: 'MODEL_INPUT' });
  assert.equal(f.controller.installing, false);
});
