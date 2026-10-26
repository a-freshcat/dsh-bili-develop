import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, realpathSync, symlinkSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fixture } from './fixtures.mjs';

test('public package and bundle names match the repository and local legacy migration loads only one bundle', t => {
  const f = fixture(t), pkg = JSON.parse(readFileSync('package.json', 'utf8'));
  assert.equal(pkg.name, 'dsh-bili-develop'); assert.match(readFileSync('cordis.patch.yml', 'utf8'), /name: dsh-bili-develop/);
  const home = join(f.root, 'fake-dsh'), profile = join(home, 'profiles', 'desktop'); mkdirSync(join(profile, 'node_modules'), { recursive: true });
  const specifier = 'link:' + resolve('.').replaceAll('\\', '/');
  symlinkSync(resolve('.'), join(profile, 'node_modules', 'dsh-bilibili-harness'), process.platform === 'win32' ? 'junction' : 'dir');
  writeFileSync(join(profile, 'package.json'), JSON.stringify({ dependencies: { 'dsh-bilibili-harness': specifier, unrelated: '1.0.0' }, dsh: { profile: { bundles: ['unrelated', 'dsh-bilibili-harness'] } } }));
  const result = spawnSync(process.execPath, ['scripts/install-desktop.mjs', '--apply'], { env: { ...process.env, DSH_HOME: home }, encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 0, result.stderr);
  const updated = JSON.parse(readFileSync(join(profile, 'package.json'), 'utf8'));
  assert.equal(updated.dependencies['dsh-bili-develop'], specifier); assert.equal(updated.dependencies['dsh-bilibili-harness'], undefined);
  assert.equal(existsSync(join(profile, 'node_modules', 'dsh-bilibili-harness')), false);
  assert.equal(existsSync('client.js'), true);
  assert.equal(updated.dependencies.unrelated, '1.0.0'); assert.deepEqual(updated.dsh.profile.bundles, ['unrelated', 'dsh-bili-develop']);
  assert.equal(realpathSync(join(profile, 'node_modules', 'dsh-bili-develop')).toLowerCase(), realpathSync('.').toLowerCase());
});
