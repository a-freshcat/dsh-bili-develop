import { mkdirSync, existsSync, readdirSync, lstatSync, readFileSync, writeFileSync, copyFileSync, realpathSync } from 'node:fs';
import { join, resolve, relative } from 'node:path';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';

// A new allowlisted tree, never a copy of the developer's Git history or workspace data.
const root = realpathSync(process.cwd()), version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
assert.ok(/^\d+\.\d+\.\d+$/.test(version), 'Export requires a release version');
const output = resolve(process.argv[2] || 'desktop-m0-m1/release-' + version);
assert.ok(output.startsWith(root + '\\') || output.startsWith(root + '/'), 'Export must stay inside the workspace');
assert.ok(!existsSync(output), 'Export target already exists; use a new empty path');
const roots = ['README.md', 'USER_GUIDE.md', 'SECURITY.md', 'CHANGELOG.md', 'THIRD_PARTY_NOTICES.md', 'LICENSE', 'package.json', 'cordis.patch.yml', 'index.js', 'client.js', '.gitignore'];
const scripts = ['check.mjs', 'install-desktop.mjs', 'setup-python.mjs', 'release-check.mjs', 'audit-dependencies.py', 'export-release.mjs', 'benchmark.mjs'];
const selected = [...roots, ...scripts.map(f => 'scripts/' + f), 'docs/dependency-audit.json', 'docs/performance-0.1.1.md', 'docs/performance-0.1.1.json'];
for (const [directory, pattern] of [['src', /\.mjs$/], ['python', /(?:\.py$|^requirements(?:-audio)?\.txt$)/], ['tests', /\.(?:mjs|py)$/]]) {
  for (const name of readdirSync(directory)) if (pattern.test(name)) selected.push(directory + '/' + name);
}
const userName = process.env.USERNAME || '', escapedName = userName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const forbidden = [/(?:gh[pousr]_[A-Za-z0-9]{24,}|github_pat_[A-Za-z0-9_]{24,}|sk-[A-Za-z0-9]{28,})/,
  /session-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,
  ...(userName && userName !== 'runner' ? [new RegExp(escapedName, 'i')] : [])];
const manifest = [];
for (const file of selected.sort()) {
  const path = join(root, file); assert.ok(lstatSync(path).isFile() && !lstatSync(path).isSymbolicLink(), 'Only ordinary source files may be exported');
  const content = readFileSync(path), text = content.toString('utf8');
  assert.ok(!forbidden.some(re => re.test(text)), 'Private marker found in ' + file);
  assert.ok(!/(?:^|\/)(?:\.git|\.workspace|\.runtime|node_modules|__pycache__|task-reports)(?:\/|$)|\.sqlite|credential\.json|\.log$/i.test(file), 'Private filename found');
  manifest.push({ path: file, bytes: content.length, sha256: createHash('sha256').update(content).digest('hex') });
}
mkdirSync(output, { recursive: true });
for (const file of selected) { const target = join(output, file); mkdirSync(resolve(target, '..'), { recursive: true }); copyFileSync(join(root, file), target); }
writeFileSync(join(output, 'SOURCE-MANIFEST.json'), JSON.stringify({ version, files: manifest }, null, 2) + '\n');
console.log(JSON.stringify({ output: relative(root, output), files: manifest.length, privateMarkers: false, gitHistoryIncluded: false }));
