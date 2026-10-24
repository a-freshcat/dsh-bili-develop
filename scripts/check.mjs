import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { bundledPython } from '../src/python.mjs';
const files = ['index.js', 'client.js'];
for (const dir of ['src', 'scripts', 'tests']) {
  for (const file of readdirSync(dir)) if (/\.(mjs|js)$/.test(file)) files.push(join(dir, file));
}
for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8', windowsHide: true });
  if (result.status !== 0) { process.stderr.write(result.stderr || result.error?.message || file); process.exit(1); }
}
const result = spawnSync(bundledPython(), ['-c',
  'import ast,pathlib; [ast.parse(p.read_text(encoding="utf-8")) for p in pathlib.Path("python").glob("*.py")]'],
{ encoding: 'utf8', windowsHide: true });
if (result.status !== 0) { process.stderr.write(result.stderr || result.error?.message || 'Python syntax failed'); process.exit(1); }
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
for (const file of [pkg.main, 'client.js', 'cordis.patch.yml']) readFileSync(file);
console.log('Syntax and entrypoints OK: ' + files.length + ' JS modules + Python.');
