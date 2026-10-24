import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fixture, BV } from './fixtures.mjs';
import { configOf } from '../src/decision.mjs';
import { DEFAULT_CONFIG, Store } from '../src/store.mjs';
import { tagSelection } from '../src/tags.mjs';

async function setup(t, options = {}) {
  const calls = [], now = Date.parse('2026-10-24T04:00:00Z');
  const tags = [{ id: '100', name: 'ＡＳＭＲ' }, { id: '200', name: '助眠' }];
  let f;
  f = fixture(t, { now: () => now, call: async (method, params) => {
    calls.push({ method, params });
    if (method === 'account') return { status: 'logged_in', uid: '123' };
    if (method === 'search_videos') return { source: 'tag', accountUid: '123', query: params.keyword,
      videos: [{ bvid: BV, title: '标题没有检索词的作品', tags }],
      tagStats: { checked: 3, verified: 2, matched: 1, mismatched: 1, unverified: 1 }, ...options.search };
    if (method === 'read_video') return { ...f.evidence, bvid: params.bvid };
    return {};
  } }); await f.bind();
  f.controller.configure({ browseTagEnabled: true, browseTags: ['ASMR', '助眠'], browseTagMatch: options.match || 'any',
    timeZone: 'Asia/Singapore', keywords: [], ...options.config });
  f.controller.scheduler.kick = () => {};
  const pump = async () => { for (let i = 0; i < 6; i++) { await f.controller.scheduler.tick(); await f.controller.idle(); } };
  return { ...f, calls, pump };
}

test('tag mode works without title keywords and persists verified platform tags in the same-session history and note', async t => {
  const f = await setup(t); await f.controller.scheduler.runNow('tag-round-first'); await f.pump();
  const run = f.store.list().find(r => r.kind === 'video');
  assert.equal(run.state, 'preview'); assert.equal(f.counters.create, 1); assert.equal(f.counters.prompt, 1);
  assert.equal(run.browseSelection.mode, 'tag'); assert.equal(run.browseSelection.query, 'asmr');
  assert.deepEqual(f.calls.find(c => c.method === 'search_videos').params.tag_filter, { tags: ['asmr', '助眠'], match: 'any' });
  assert.ok((await f.controller.status()).runs[0].browseSelection.tags.some(t => t.id === '100'));
  assert.match(readFileSync(join(f.workspacePath, run.notePath), 'utf8'), /TAG浏览入口[\s\S]*实际标签：ＡＳＭＲ/);
  assert.deepEqual(f.store.round('tag-round-first').tagSearchStats, { checked: 3, verified: 2, matched: 1, mismatched: 1, unverified: 1 });
  const reopened = new Store(join(f.root, 'state.sqlite'));
  try {
    assert.equal(reopened.config().browseTagEnabled, true);
    assert.deepEqual(reopened.run(run.id).browseSelection, run.browseSelection);
  } finally { reopened.close(); }
});

test('nonmatching titles, missing real tags and forged tag query/account never start a model analysis', async t => {
  for (const search of [
    { videos: [{ bvid: BV, title: 'ASMR 助眠', tags: [{ id: '300', name: '游戏' }] }] },
    { videos: [{ bvid: BV, title: 'ASMR 助眠' }] }, { accountUid: '999' }, { query: '不是当前查询' }, { source: 'keyword' }]) {
    const f = await setup(t, { search }); await f.controller.scheduler.runNow('tag-block-round'); await f.pump();
    assert.equal(f.counters.prompt, 0); assert.equal(f.calls.filter(c => c.method === 'read_video').length, 0);
    assert.equal(f.store.budget(f.store.config()).analyses, 0); assert.equal(f.store.round('tag-block-round').state, 'failed');
  }
});

test('empty verified candidate page ends visibly without analyses, fallback or repeated searches', async t => {
  const f = await setup(t, { search: { videos: [], tagStats: { checked: 2, verified: 1, matched: 0, mismatched: 1, unverified: 1 } } });
  await f.controller.scheduler.runNow('tag-empty-round'); await f.pump();
  assert.equal(f.store.round('tag-empty-round').state, 'completed');
  assert.match(f.store.round('tag-empty-round').reason, /没有满足实际TAG/);
  assert.equal(f.calls.filter(c => c.method === 'search_videos').length, 1); assert.equal(f.counters.prompt, 0);
  assert.equal(f.store.budget(f.store.config(), Date.parse('2026-10-24T04:00:00Z')).analyses, 0);
});

test('any/all are exact normalized tag matching, never substring or title matching', () => {
  const video = { tags: [{ id: '1', name: 'ＡＳＭＲ' }, { id: '2', name: '助眠' }] };
  assert.ok(tagSelection(video, { tags: ['asmr', '助眠'], match: 'all' }, 'asmr', 1));
  assert.ok(tagSelection(video, { tags: ['asmr', '游戏'], match: 'any' }, 'asmr', 1));
  assert.throws(() => tagSelection(video, { tags: ['asmr', '游戏'], match: 'all' }, 'asmr', 1));
  assert.throws(() => tagSelection(video, { tags: ['asm'], match: 'any' }, 'asm', 1));
});

test('tag search pages are separated from keyword pages and tag configuration changes end pending candidates', async t => {
  const f = await setup(t); await f.controller.scheduler.runNow('tag-pages-round');
  const round = f.store.round('tag-pages-round');
  assert.equal(f.store.get('searchPages')[round.searchKey], 2); assert.equal(f.store.get('searchPages').asmr, undefined);
  f.controller.configure({ browseTags: ['游戏'] }); assert.equal(f.store.round(round.id).state, 'cancelled');
  assert.equal(f.counters.prompt, 0);
});

test('manual BV reading remains explicit and independent of automatic TAG limits', async t => {
  const f = await setup(t);
  await f.controller.start({ requestId: 'tag-manual-read', bvid: BV }); await f.controller.idle();
  assert.equal(f.store.run('tag-manual-read').state, 'preview'); assert.equal(f.store.run('tag-manual-read').browseSelection, undefined);
  assert.equal(f.calls.filter(c => c.method === 'search_videos').length, 0);
});

test('TAG settings are optional and validated before automatic browsing can be enabled', () => {
  assert.equal(DEFAULT_CONFIG.browseTagEnabled, false);
  for (const input of [{ browseTagEnabled: true }, { browseTagEnabled: 'true' }, { browseTags: [''] }, { browseTags: ['bad\nline'] },
    { browseTagMatch: 'some' }, { browseTags: new Array(11).fill('ASMR') }]) assert.throws(() => configOf(input, DEFAULT_CONFIG));
  const config = configOf({ browseTagEnabled: true, browseTags: [' ASMR ', 'ＡＳＭＲ'], keywords: [], autoEnabled: true }, DEFAULT_CONFIG);
  assert.deepEqual(config.browseTags, ['asmr']); assert.equal(config.autoEnabled, true);
});
