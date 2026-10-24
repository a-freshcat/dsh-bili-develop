import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { fixture, BV } from './fixtures.mjs';
import { Store } from '../src/store.mjs';
import { coverUrl } from '../src/media.mjs';

const COVER = 'https://i0.hdslb.com/bfs/archive/fixture.jpg';
test('cover URLs allow only the image CDN and upgrade HTTP', () => {
  assert.equal(coverUrl(COVER), COVER);
  assert.equal(coverUrl('http://i0.hdslb.com/a.jpg'), 'https://i0.hdslb.com/a.jpg');
  for (const url of ['javascript:alert(1)', 'https://hdslb.com.evil.test/a', 'https://u:p@i0.hdslb.com/a',
    'https://i0.hdslb.com:8080/a', 'file:///C:/secret', null]) assert.equal(coverUrl(url), '');
});

test('new video records persist their cover and expose it in the history summary', async t => {
  const f = fixture(t, { evidence: { cover: COVER } }); await f.bind();
  await f.controller.start({ requestId: 'cover-new-video', bvid: BV }); await f.controller.idle();
  assert.equal(f.store.run('cover-new-video').evidence.cover, COVER);
  assert.equal((await f.controller.status()).runs[0].evidence.cover, COVER);
});

test('old covers are fetched once per video and persist without model or quota changes', async t => {
  const f = fixture(t); await f.bind();
  for (const id of ['cover-old-first', 'cover-old-second']) {
    await f.controller.start({ requestId: id, bvid: BV }); await f.controller.idle();
  }
  const usage = f.store.budget(f.store.config()), prompts = f.counters.prompt;
  const preview = f.store.run('cover-old-first').preview;
  let calls = 0;
  f.controller.reader = () => ({ async call(method, params) { assert.equal(method, 'read_cover'); calls++; return { bvid: params.bvid, cover: COVER }; } });
  assert.equal((await f.controller.dispatch({ action: 'refresh_covers', offset: 0 })).state, 'running');
  await f.controller.coverJob;
  assert.equal(calls, 1); assert.equal(f.counters.prompt, prompts);
  assert.deepEqual(f.store.budget(f.store.config()), usage);
  assert.deepEqual(f.store.run('cover-old-first').preview, preview);
  for (const run of f.store.list()) assert.equal(run.evidence.cover, COVER);
  const reopened = new Store(join(f.root, 'state.sqlite'));
  try { assert.equal(reopened.run('cover-old-first').evidence.cover, COVER); } finally { reopened.close(); }
  await f.controller.dispatch({ action: 'refresh_covers', offset: 0 });
  assert.equal(calls, 1);
});

test('backfill prevents a concurrent worker check and recovers after a bad cover', async t => {
  const f = fixture(t); await f.bind();
  await f.controller.start({ requestId: 'cover-failure-video', bvid: BV }); await f.controller.idle();
  let finish;
  f.controller.reader = () => ({ call() { return new Promise(resolve => { finish = resolve; }); } });
  f.controller.refreshCovers(); await new Promise(resolve => setImmediate(resolve));
  await assert.rejects(f.controller.dispatch({ action: 'reader_ping' }), { code: 'RUN_BUSY' });
  assert.throws(() => f.controller.configure({ persona: 'changed' }), { code: 'RUN_BUSY' });
  finish({ bvid: BV, cover: 'https://evil.test/track.png' }); await f.controller.coverJob;
  assert.equal(f.controller.metadataBusy, false);
  assert.equal(f.controller.coverState.failed, 1); assert.equal(f.controller.coverState.error.code, 'COVER_MISSING');
  assert.equal(f.store.run('cover-failure-video').evidence.cover, '');
});

test('manual admission racing with cover backfill cannot start a second worker task or spend quota', async t => {
  const f = fixture(t); await f.bind();
  await f.controller.start({ requestId: 'cover-race-existing', bvid: BV }); await f.controller.idle();
  let finishBinding, finishCover;
  f.host.requireBinding = () => new Promise(resolve => { finishBinding = resolve; });
  const pending = f.controller.start({ requestId: 'cover-race-newread', bvid: BV });
  f.controller.reader = () => ({ call() { return new Promise(resolve => { finishCover = resolve; }); } });
  f.controller.refreshCovers(); await new Promise(resolve => setImmediate(resolve));
  finishBinding(f.store.get('binding'));
  await assert.rejects(pending, { code: 'RUN_BUSY' });
  assert.equal(f.store.run('cover-race-newread'), null);
  assert.equal(f.store.budget(f.store.config()).analyses, 1);
  finishCover({ bvid: BV, cover: COVER }); await f.controller.coverJob;
});
