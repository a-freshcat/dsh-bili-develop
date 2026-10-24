// Synthetic local benchmark. No real profile, credentials, model or network calls.
import { performance } from 'node:perf_hooks';
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { fixture } from '../tests/fixtures.mjs';
import { previewPrompt } from '../src/decision.mjs';
import { DEFAULT_CONFIG } from '../src/store.mjs';

const at = Date.parse('2026-10-24T12:00:00+08:00');
const cleanups = [], f = fixture({ after(fn) { cleanups.push(fn); } }, { now: () => at });
try {
  const binding = await f.bind(), db = f.store.db, now = at;
  f.controller.social.setAccount('123'); f.store.set('learningAccount', '123');
  f.store.transaction(() => {
    const digest = db.prepare('INSERT INTO privacy_digests VALUES(?,?,?,?,?)');
    for (let i = 0; i < 50000; i++) digest.run(binding.sessionId, '123', '456', 16, createHash('sha256').update('synthetic-' + i).digest('hex'));
    const scope = db.prepare('INSERT INTO privacy_scopes VALUES(?,?,?,?)');
    for (let i = 0; i < 10000; i++) scope.run('synthetic-scope-' + i, binding.sessionId, '123', String(1000 + i % 100));
    for (let i = 0; i < 2000; i++) f.controller.social.contacts.put('123', String(1000 + i), { score: 60 + i % 41, fan: true, name: '合成粉丝' + i });
    const message = db.prepare('INSERT INTO private_messages VALUES(?,?,?,?,?,?)'), attempt = db.prepare('INSERT INTO private_attempts VALUES(?,?,?,?)');
    for (let i = 0; i < 20000; i++) {
      const id = 'synthetic-message-' + i, uid = String(1000 + i % 2000), at = now - i * 10000;
      message.run(id, '123', uid, 'sent', at, JSON.stringify({ id, accountUid: '123', uid, at, state: 'sent', text: '合成来信', draft: '合成回复' }));
      attempt.run(id, '123', uid, at);
    }
    for (let i = 0; i < 100; i++) f.controller.learning.saveEntry({ id: 'synthetic-entry-' + i, accountUid: '123', expression: '合成表达' + i,
      meaning: '合成含义', context: '合成场景', state: 'candidate', sourceCount: 1, sources: [], uses: 0, version: 1 });
    for (let i = 0; i < 20000; i++) f.controller.learning.event('123', 'synthetic-entry-' + i % 100, { state: 'candidate' }, { state: 'active' }, '合成理由', 'synthetic', 'adopt');
  });
  const measure = async (name, fn, repetitions = 12) => {
    for (let i = 0; i < 3; i++) await fn();
    const samples = [];
    for (let i = 0; i < repetitions; i++) { const start = performance.now(); await fn(); samples.push(performance.now() - start); }
    samples.sort((a, b) => a - b);
    return { name, repetitions, medianMs: +samples[Math.floor(samples.length / 2)].toFixed(3), p95Ms: +samples[Math.ceil(samples.length * .95) - 1].toFixed(3) };
  };
  const results = [];
  results.push(await measure('privacy-check-50k-digests', () => f.controller.privacy.check('根据实际字幕整理公开评价，先说具体观察，再解释判断的依据。'.repeat(15))));
  results.push(await measure('privacy-context-10k-scopes', () => f.controller.privacy.context()));
  results.push(await measure('social-status-2k-contacts-20k-messages', () => f.controller.social.status()));
  results.push(await measure('full-status', () => f.controller.status()));
  const segments = Array.from({ length: 300 }, (_, i) => ({ from: i, to: i + 1, text: '公开字幕合成材料，先核对事实再表达感受。' + i }));
  const evidence = { bvid: 'BV1xx411c7mD', title: '公开合成字幕', source: 'subtitle', coverage: 'complete', segments };
  const promptChars = previewPrompt({ id: 'synthetic-prompt-comparison' }, evidence, DEFAULT_CONFIG).length;
  const report = { synthetic: true, node: process.version, counts: { digests: 50000, scopes: 10000, contacts: 2000, messages: 20000, learningEvents: 20000 }, promptChars, results };
  if (process.argv[2]) writeFileSync(process.argv[2], JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report));
} finally { for (const cleanup of cleanups.reverse()) cleanup(); }
