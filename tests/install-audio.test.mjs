import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fixture } from './fixtures.mjs';
import { installAudio, pythonFor } from '../src/python.mjs';
import { PluginError } from '../src/errors.mjs';

async function pipSandbox(t, body, script = 'while True:\n time.sleep(.1)\n') {
  const f = fixture(t), marker = join(f.root, 'pip.pid');
  mkdirSync(join(f.root, 'pip'));
  writeFileSync(join(f.root, 'pip', '__init__.py'), '');
  writeFileSync(join(f.root, 'pip', '__main__.py'), 'import os,time,sys\nfrom pathlib import Path\n' +
    'Path(os.environ["BILI_SETUP_FIXTURE_PID"]).write_text(str(os.getpid()))\n' + script);
  const oldPath = process.env.PYTHONPATH, oldMarker = process.env.BILI_SETUP_FIXTURE_PID;
  process.env.PYTHONPATH = f.root; process.env.BILI_SETUP_FIXTURE_PID = marker;
  const abort = new AbortController(), jobs = [];
  const run = (options = {}) => {
    const promise = installAudio({ python: pythonFor({}, f.root, process.cwd()), temporary: join(f.root, 'setup'),
      requirements: join(process.cwd(), 'python', 'requirements-audio.txt'), signal: abort.signal, ...options });
    promise.catch(() => {}); jobs.push(promise); return promise;
  };
  const started = async () => {
    for (let i = 0; i < 200 && !existsSync(marker); i++) await new Promise(resolve => setTimeout(resolve, 10));
    assert.ok(existsSync(marker)); return Number(readFileSync(marker, 'utf8'));
  };
  const watchdog = setTimeout(() => { abort.abort(); f.controller.installAbort?.abort(); }, 5000);
  try { await body({ f, run, started }); }
  finally {
    clearTimeout(watchdog); abort.abort(); f.controller.installAbort?.abort();
    await Promise.allSettled([...jobs, f.controller.installJob]);
    if (oldPath === undefined) delete process.env.PYTHONPATH; else process.env.PYTHONPATH = oldPath;
    if (oldMarker === undefined) delete process.env.BILI_SETUP_FIXTURE_PID; else process.env.BILI_SETUP_FIXTURE_PID = oldMarker;
  }
}

test('empty or null model path does not reinstall healthy audio dependencies', async t => {
  const f = fixture(t);
  for (const path of ['', null]) {
    f.store.set('config', { ...f.store.config(), asrModelPath: path });
    f.controller.reader = () => ({ async call(method) {
      return method === 'ping' ? { protocol: 1, bilibiliApi: '17.4.2' } : { dependencies: true, ready: false, modelFiles: false };
    } });
    f.controller.installAudio = async () => { throw new Error('healthy dependencies must not be reinstalled'); };
    await f.controller.dispatch({ action: 'install_audio' }); await f.controller.installJob;
    assert.equal(f.controller.installing, false);
    assert.equal(f.controller.installState.state, 'ready');
    assert.equal(f.controller.audioEnvironment.dependencies, true);
  }
});

test('audio setup exposes live package download progress while its actual subprocess is still running', async t => {
  const f = fixture(t);
  const packageDir = join(f.root, 'pip'); mkdirSync(packageDir);
  writeFileSync(join(packageDir, '__init__.py'), '');
  writeFileSync(join(packageDir, '__main__.py'),
    'import os,time\nfrom pathlib import Path\nprint("Collecting av>=11",flush=True)\n' +
    'print("Downloading av-19.0.2-cp312-abi3-win_amd64.whl (28.2 MB)",flush=True)\n' +
    'print("Looking in indexes: https://user:fixture-secret@example.test/simple",flush=True)\n' +
    'print("Progress 4194304 of 28150949",flush=True)\n' +
    'Path(os.environ["BILI_SETUP_FIXTURE_PID"]).write_text(str(os.getpid()))\nwhile True:\n time.sleep(1)\n');
  const marker = join(f.root, 'pip.started');
  const oldPath = process.env.PYTHONPATH, oldMarker = process.env.BILI_SETUP_FIXTURE_PID;
  process.env.PYTHONPATH = f.root; process.env.BILI_SETUP_FIXTURE_PID = marker;
  f.controller.reader = () => ({ async call(method) {
    return method === 'ping' ? { protocol: 1, bilibiliApi: '17.4.2' } : { dependencies: false, ready: false };
  } });
  f.controller.installAudio = options => installAudio({ ...options,
    python: pythonFor({}, f.root, process.cwd()), temporary: join(f.root, 'setup'),
    requirements: join(process.cwd(), 'python', 'requirements-audio.txt') });
  let state;
  try {
    await f.controller.dispatch({ action: 'install_audio' });
    for (let i = 0; i < 150 && !existsSync(marker); i++) await new Promise(resolve => setTimeout(resolve, 20));
    assert.ok(existsSync(marker), 'the actual pip subprocess must reach its downloading operation');
    await new Promise(resolve => setTimeout(resolve, 40));
    state = (await f.controller.status()).install;
  } finally {
    f.controller.installAbort?.abort();
    await f.controller.installJob;
    if (oldPath === undefined) delete process.env.PYTHONPATH; else process.env.PYTHONPATH = oldPath;
    if (oldMarker === undefined) delete process.env.BILI_SETUP_FIXTURE_PID; else process.env.BILI_SETUP_FIXTURE_PID = oldMarker;
    if (existsSync(marker)) {
      const pid = Number(readFileSync(marker, 'utf8'));
      for (let i = 0; i < 100; i++) {
        try { process.kill(pid, 0); } catch { break; }
        await new Promise(resolve => setTimeout(resolve, 10));
      }
    }
  }
  assert.equal(state.state, 'installing');
  assert.equal(state.packageName, 'av', 'settings must show which package is downloading instead of a frozen generic preparation label');
  assert.equal(state.downloadedBytes, 4194304); assert.equal(state.totalBytes, 28150949);
  assert.doesNotMatch(JSON.stringify(state), /fixture-secret|example.test/);
});

test('stopping audio preparation keeps it locked until the real subprocess exits, then permits another check', async t => {
  await pipSandbox(t, async ({ f, run, started }) => {
    await f.bind(); const binding = f.store.get('binding'); let ready = false, installs = 0;
    f.controller.reader = () => ({ async call(method) {
      return method === 'ping' ? { protocol: 1, bilibiliApi: '17.4.2' } : { dependencies: ready, ready: false };
    } });
    f.controller.installAudio = options => { installs++; return run(options); };
    await f.controller.dispatch({ action: 'install_audio' }); await started();
    const heartbeat = join(f.root, 'pip.heartbeat');
    for (let i = 0; i < 100 && !existsSync(heartbeat); i++) await new Promise(resolve => setTimeout(resolve, 10));
    assert.ok(existsSync(heartbeat));
    await f.controller.dispatch({ action: 'cancel_audio' });
    assert.equal(f.controller.installing, true);
    await f.controller.installJob;
    assert.equal(f.controller.installing, false); assert.equal(f.controller.installState.state, 'cancelled');
    // The install promise resolves on this child's close event. A numeric PID
    // can be reused by another parallel test; verify this worker stopped work.
    const stoppedAt = readFileSync(heartbeat, 'utf8');
    await new Promise(resolve => setTimeout(resolve, 250));
    assert.equal(readFileSync(heartbeat, 'utf8'), stoppedAt, 'the cancelled installer must stop updating its own heartbeat');
    ready = true; await f.controller.dispatch({ action: 'install_audio' }); await f.controller.installJob;
    assert.equal(f.controller.installState.state, 'ready'); assert.equal(installs, 1);
    assert.deepEqual(f.store.get('binding'), binding); assert.equal(f.store.count(), 0);
  }, 'counter=0\nwhile True:\n counter+=1\n Path(os.environ["BILI_SETUP_FIXTURE_PID"]).with_suffix(".heartbeat").write_text(str(counter))\n time.sleep(.02)\n');
});

test('a silent installer is stopped with a distinct stalled result and no leftover process', async t => {
  await pipSandbox(t, async ({ run, started }) => {
    const pending = run({ idleTimeoutMs: 1000, timeoutMs: 3000 }); const pid = await started();
    await assert.rejects(pending, { code: 'INSTALL_STALLED' }); assert.throws(() => process.kill(pid, 0));
  });
});

test('a total deadline also stops an installer that keeps printing activity', async t => {
  await pipSandbox(t, async ({ run, started }) => {
    const pending = run({ idleTimeoutMs: 3000, timeoutMs: 1000 }); const pid = await started();
    await assert.rejects(pending, { code: 'INSTALL_TIMEOUT' }); assert.throws(() => process.kill(pid, 0));
  }, 'while True:\n print("Progress 1 of 2",flush=True)\n time.sleep(.05)\n');
});

test('installer failures classify network problems without disclosing index or proxy credentials', async t => {
  await pipSandbox(t, async ({ run }) => {
    const updates = [];
    await assert.rejects(run({ onProgress: value => updates.push(value) }), error => {
      assert.equal(error.code, 'INSTALL_NETWORK'); assert.doesNotMatch(error.message, /fixture-secret|example.test/); return true;
    });
    assert.doesNotMatch(JSON.stringify(updates), /fixture-secret|example.test/);
  }, 'print("WARNING: Retrying after connection broken by ReadTimeout https://user:fixture-secret@example.test",flush=True)\nsys.exit(1)\n');
});

test('cancelling during the environment check is distinct from a failed check for audio and model setup', async t => {
  const f = fixture(t); let rejectCheck;
  f.controller.reader = () => ({ async call(method) {
    if (method === 'ping') return { protocol: 1, bilibiliApi: '17.4.2' };
    return new Promise((_resolve, reject) => { rejectCheck = reject; });
  } });
  f.controller.resetReader = () => rejectCheck?.(new PluginError('READER_CLOSED', '检查进程已停止。'));
  for (const action of ['install_audio', 'prepare_asr_model']) {
    await f.controller.dispatch({ action, model: 'tiny', source: 'official' });
    await new Promise(resolve => setImmediate(resolve));
    await f.controller.dispatch({ action: action === 'install_audio' ? 'cancel_audio' : 'cancel_asr_model' });
    await f.controller.installJob;
    assert.equal(f.controller.installState.state, 'cancelled'); assert.equal(f.controller.installing, false);
  }
});

test('a null environment response returns a useful error and releases preparation', async t => {
  const f = fixture(t);
  f.controller.reader = () => ({ async call(method) {
    return method === 'ping' ? { protocol: 1, bilibiliApi: '17.4.2' } : null;
  } });
  await f.controller.dispatch({ action: 'install_audio' }); await f.controller.installJob;
  assert.equal(f.controller.installState.error.code, 'AUDIO_NOT_READY'); assert.equal(f.controller.installing, false);
});
