import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const metadata = JSON.parse(readFileSync(process.argv[2] || '.runtime/completion-pack.json', 'utf8'));
assert.equal(metadata.length, 1);
const pack = metadata[0], files = pack.files.map(f => f.path);
assert.equal(pack.version, pkg.version); assert.equal(pack.name, pkg.name);
assert.ok(/^[a-z0-9._-]+\.tgz$/.test(pack.filename));
for (const file of ['index.js', 'client.js', 'package.json', 'cordis.patch.yml', 'README.md', 'USER_GUIDE.md',
  ...readdirSync('src').filter(f => f.endsWith('.mjs')).map(f => 'src/' + f),
  ...pkg.files.filter(f => f.startsWith('python/'))]) assert.ok(files.includes(file), 'Missing runtime file: ' + file);
assert.ok(files.every(f => ['index.js', 'client.js', 'package.json', 'cordis.patch.yml', 'README.md'].includes(f) ||
  (f.startsWith('src/') && f.endsWith('.mjs')) || pkg.files.includes(f)), 'Unexpected package files');
assert.ok(!files.some(f => /(^|\/)(?:node_modules|\.runtime|\.venv|\.git)(\/|$)|credential|\.sqlite|\.log$|^tests\//i.test(f)), 'Runtime/private artifacts entered the package');
const artifact = resolve(join('dist', pack.filename));
assert.equal(statSync(artifact).size, pack.size);
assert.equal('sha512-' + createHash('sha512').update(readFileSync(artifact)).digest('base64'), pack.integrity);
console.log(JSON.stringify({ version: pkg.version, files: files.length, bytes: pack.size, integrityVerified: true, privateFiles: false, artifact: pack.filename }));
