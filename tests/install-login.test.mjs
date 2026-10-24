import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './fixtures.mjs';
async function pendingInstall(f, { failure = false } = {}) {
  let first = true, finish;
  f.controller.reader = () => ({ async call() {
    if (first) { first = false; throw new Error('missing fixture environment'); }
    return { protocol: 1, bilibiliApi: '17.4.2' };
  } });
  f.controller.install = () => new Promise((resolve, reject) => { finish = failure ? reject : resolve; });
  await f.controller.dispatch({ action: 'install_python' });
  await new Promise(resolve => setImmediate(resolve));
  return value => finish(value);
}

test('environment check cannot finish an installation that is still running', async t => {
  const f = fixture(t);
  const finish = await pendingInstall(f);
  await f.controller.dispatch({ action: 'reader_ping' });
  const state = (await f.controller.status()).install.state;
  finish(); await f.controller.installJob;
  assert.equal(state, 'installing', 'Ping must not conceal the active install job');
});
test('login cannot start while dependency completion can still replace its reader', async t => {
  const f = fixture(t);
  const finish = await pendingInstall(f);
  let error;
  try { await f.controller.dispatch({ action: 'login_start' }); } catch (e) { error = e; }
  finish(); await f.controller.installJob;
  assert.equal(error?.code, 'INSTALL_BUSY', 'Never create a QR session that the installer can discard');
});
test('installer failure is reported even after a successful reader ping', async t => {
  const f = fixture(t);
  const fail = await pendingInstall(f, { failure: true });
  await f.controller.dispatch({ action: 'reader_ping' });
  fail(new Error('offline fixture')); await f.controller.installJob;
  assert.equal((await f.controller.status()).install.state, 'failed');
});
test('healthy environment skips reinstallation and keeps the active login worker', async t => {
  const f = fixture(t);
  let installs = 0, resets = 0;
  f.controller.install = async () => { installs++; };
  f.controller.resetReader = () => { resets++; };
  await f.controller.dispatch({ action: 'install_python' });
  await f.controller.installJob;
  assert.equal(installs, 0);
  assert.equal(resets, 0);
  assert.equal((await f.controller.status()).install.state, 'ready');
});
