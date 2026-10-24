import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { dayWindow } from '../src/time.mjs';
import { runInNewContext } from 'node:vm';
import { DEFAULT_CONFIG } from '../src/store.mjs';
import { configOf } from '../src/decision.mjs';
import { fixture } from './fixtures.mjs';
function client(fetch) {
  let plugin;
  const scope = { window: { __ModuleLoader__: { load: definition => {
    plugin = definition.factory(() => ({}));
  } } }, fetch, setTimeout, clearTimeout, AbortController, Response, console };
  scope.globalThis = scope;
  runInNewContext(readFileSync('client.js', 'utf8'), scope);
  return plugin;
}

test('relationship controls default collapsed and off, independently save follow/proactive settings without launching any interaction', async t => {
  const f = fixture(t); await f.bind(); f.controller.social.setAccount('123');
  let plugin, settings, stateIndex = 0, refIndex = 0;
  const values = [], refs = [], effects = [], calls = [];
  const React = { createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity) }),
    useState(initial) { const i = stateIndex++; if (!(i in values)) values[i] = initial; return [values[i], v => { values[i] = typeof v === 'function' ? v(values[i]) : v; }]; },
    useRef(initial) { const i = refIndex++; return refs[i] ||= { current: initial }; }, useEffect(fn) { effects.push(fn); } };
  const scope = { window: { __ModuleLoader__: { load: module => { plugin = module.factory(() => React); } } },
    fetch: async (_url, options) => { const input = JSON.parse(options.body); calls.push(input); return Response.json({ ok: true, value: await f.controller.dispatch(input) }); },
    setTimeout, clearTimeout, setInterval: () => 1, clearInterval() {}, AbortController, Response, crypto: { randomUUID: () => 'relationship-ui-request' } };
  scope.globalThis = scope; runInNewContext(readFileSync('client.js', 'utf8'), scope);
  plugin.apply({ get: n => n === 'slots' ? { inject: (_n, cb) => cb(), register: (_o, fn) => { settings = fn; } } : { openSession() {} } });
  const panel = settings({}), flat = n => n && typeof n === 'object' ? [n, ...n.children.flatMap(flat)] : [n];
  const render = () => { stateIndex = 0; refIndex = 0; effects.length = 0; return panel.type(panel.props); };
  render(); const cleanup = effects[0](); await new Promise(r => setImmediate(r)); let tree = render();
  const summary = '80分关注与100分每日主动私信（独立开关）';
  const section = flat(tree).find(n => n?.type === 'details' && flat(n).some(c => c?.type === 'summary' && c.children.includes(summary)));
  assert.ok(section); assert.ok(!section.props.open);
  const toggle = (tree, label) => flat(flat(tree).find(n => n?.type === 'label' && n.children.includes(label))).find(n => n?.type === 'input');
  const followLabel = '好感达到80分后自动关注认识的人（默认关闭）', proactiveLabel = '好感100分后每天主动私信问候（默认关闭）';
  assert.equal(toggle(tree, followLabel).props.checked, false); assert.equal(toggle(tree, proactiveLabel).props.checked, false);
  toggle(tree, proactiveLabel).props.onChange({ target: { checked: true } }); tree = render();
  await flat(tree).find(n => n?.type === 'button' && n.children.includes('保存关系互动设置')).props.onClick(); await new Promise(r => setImmediate(r));
  assert.equal(f.store.config().dmProactiveEnabled, true); assert.equal(f.store.config().autoFollowEnabled, false); assert.equal(f.store.config().dmEnabled, false);
  assert.ok(calls.every(c => ['status', 'configure'].includes(c.action))); assert.equal(f.counters.prompt, 0); assert.equal(f.counters.read, 0); cleanup();
});

test('autonomous browsing UI saves its mode with empty keywords, restores it on reopening, and never selects on refresh', async t => {
  const f = fixture(t); await f.bind();
  let plugin, settings, stateIndex = 0, refIndex = 0;
  const values = [], refs = [], effects = [], calls = [];
  const React = { createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity) }),
    useState(initial) { const i = stateIndex++; if (!(i in values)) values[i] = initial; return [values[i], v => { values[i] = typeof v === 'function' ? v(values[i]) : v; }]; },
    useRef(initial) { const i = refIndex++; return refs[i] ||= { current: initial }; }, useEffect(fn) { effects.push(fn); } };
  const scope = { window: { __ModuleLoader__: { load: module => { plugin = module.factory(() => React); } } },
    fetch: async (_url, options) => { const input = JSON.parse(options.body); calls.push(input); return Response.json({ ok: true, value: await f.controller.dispatch(input) }); },
    setTimeout, clearTimeout, setInterval: () => 1, clearInterval() {}, AbortController, Response, crypto: { randomUUID: () => 'autonomous-ui-request' } };
  scope.globalThis = scope; runInNewContext(readFileSync('client.js', 'utf8'), scope);
  plugin.apply({ get: n => n === 'slots' ? { inject: (_n, cb) => cb(), register: (_o, fn) => { settings = fn; } } : { openSession() {} } });
  const panel = settings({}), flat = n => n && typeof n === 'object' ? [n, ...n.children.flatMap(flat)] : [n];
  const button = (tree, label) => flat(tree).find(n => n?.type === 'button' && n.children.includes(label));
  const render = () => { stateIndex = 0; refIndex = 0; effects.length = 0; return panel.type(panel.props); };
  const flush = () => new Promise(resolve => setImmediate(resolve));
  render(); let cleanup = effects[0](); await flush(); let tree = render();
  const options = flat(tree).find(n => n?.type === 'details' && flat(n).some(c => c?.type === 'summary' && c.children.includes('浏览设置'))); assert.ok(!options.props.open);
  assert.equal(button(tree, '立即运行一轮').props.disabled, true);
  button(tree, '自主选片').props.onClick(); tree = render();
  assert.equal(button(tree, '自主选片').props['aria-pressed'], true);
  assert.equal(button(tree, '立即运行一轮').props.disabled, true, 'mode is not applied before save');
  await button(tree, '保存浏览设置').props.onClick(); await flush(); tree = render();
  assert.equal(f.store.config().browseMode, 'autonomous'); assert.deepEqual(f.store.config().keywords, []);
  assert.equal(button(tree, '立即运行一轮').props.disabled, false);
  const keywordLabel = flat(tree).find(n => n?.type === 'label' && flat(n).includes('关键词（每行一个，最多20个）'));
  const keywordArea = flat(keywordLabel).find(n => n?.type === 'textarea');
  assert.ok(keywordArea); assert.ok(flat(tree).some(n => n?.type === 'div' && n.props.hidden === true && flat(n).includes(keywordArea)));
  cleanup(); values.length = 0; refs.length = 0; render(); cleanup = effects[0](); await flush(); tree = render();
  assert.equal(button(tree, '自主选片').props['aria-pressed'], true);
  assert.ok(calls.every(c => ['status', 'configure'].includes(c.action))); assert.equal(f.counters.prompt, 0); assert.equal(f.counters.read, 0);
  cleanup();
});

test('learning UI searches only after applying, pages complete sources and old reviews, and exports the saved result without another model task', async t => {
  const f = fixture(t); await f.bind(); f.store.set('learningAccount', '123');
  const l = f.controller.learning, binding = f.store.get('binding');
  const entry = { id: 'expr-ui-archive', accountUid: '123', expression: '先看证据', state: 'active', version: 1, uses: 0,
    meaning: '先检查来源', context: '讨论时', avoid: '', example: '先看证据再判断。', sourceCount: 25, sources: [] };
  l.saveEntry(entry);
  for (let n = 0; n < 25; n++) {
    const bvid = 'BV' + String(n).padStart(10, '0');
    f.store.db.prepare('INSERT INTO learning_evidence VALUES(?,?,?)').run(entry.id, bvid, JSON.stringify({ bvid, quote: '公开证据' + n, url: 'https://www.bilibili.com/video/' + bvid }));
  }
  for (let n = 0; n < 12; n++) l.event('123', entry.id, entry, { ...entry, state: 'reduced' }, '表达变更' + n, 'user', 'reduce');
  const reviewIds = [];
  for (let n = 0; n < 12; n++) {
    const window = dayWindow(Date.parse('2026-09-01T12:00:00Z') + n * 86400000, 'Asia/Singapore');
    const id = 'learn-' + createHash('sha256').update(JSON.stringify(['123', binding.sessionId, window.start, window.end])).digest('hex').slice(0, 40);
    l.saveReview({ id, accountUid: '123', ...window, state: 'completed', stats: { observations: 1, videos: 1 }, comparison: '保留适合的部分。',
      iterationBefore: { version: n, traits: [] }, iterationAfter: { version: n + 1, traits: [] }, sources: [] });
    reviewIds.push(id);
  }
  let plugin, settings, stateIndex = 0, refIndex = 0;
  const values = [], refs = [], effects = [], calls = [];
  const React = { createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity) }),
    useState(initial) { const i = stateIndex++; if (!(i in values)) values[i] = initial; return [values[i], v => { values[i] = typeof v === 'function' ? v(values[i]) : v; }]; },
    useRef(initial) { const i = refIndex++; return refs[i] ||= { current: initial }; }, useEffect(fn) { effects.push(fn); } };
  const scope = { window: { __ModuleLoader__: { load: module => { plugin = module.factory(() => React); } } },
    fetch: async (_url, options) => { const input = JSON.parse(options.body); calls.push(input); return Response.json({ ok: true, value: await f.controller.dispatch(input) }); },
    setTimeout, clearTimeout, setInterval: () => 1, clearInterval() {}, AbortController, Response, crypto: { randomUUID: () => 'learning-ui-archive' } };
  scope.globalThis = scope; runInNewContext(readFileSync('client.js', 'utf8'), scope);
  plugin.apply({ get: n => n === 'slots' ? { inject: (_n, cb) => cb(), register: (_o, fn) => { settings = fn; } } : { openSession() {} } });
  const panel = settings({}), flat = n => n && typeof n === 'object' ? [n, ...n.children.flatMap(flat)] : [n];
  const text = n => flat(n).filter(x => typeof x === 'string').join('');
  const button = (tree, label) => flat(tree).find(n => n?.type === 'button' && text(n) === label);
  const pane = (tree, id) => flat(tree).find(n => n?.props?.id === id);
  const render = () => { stateIndex = 0; refIndex = 0; effects.length = 0; return panel.type(panel.props); };
  const flush = () => new Promise(resolve => setImmediate(resolve));
  render(); const cleanup = effects[0](); t.after(cleanup); await flush();
  let tree = render(); button(tree, '人设').props.onClick(); tree = render(); button(tree, '表达').props.onClick(); tree = render();
  const filter = pane(tree, 'bili-learning-filter'); assert.ok(!filter.props.open);
  const search = flat(filter).find(n => n?.type === 'input'); search.props.onChange({ target: { value: '不存在的表达' } });
  tree = render(); assert.equal(values[0].learning.total, 1, 'typing must not apply or save the filter');
  await button(tree, '应用表达筛选').props.onClick(); await flush(); tree = render(); assert.equal(values[0].learning.total, 0);
  await button(tree, '清除表达筛选').props.onClick(); await flush(); tree = render();
  await button(tree, '查看完整来源与变更').props.onClick(); await flush(); tree = render();
  assert.equal(values[0].learning.focus.sources.length, 10); assert.ok(!button(tree, '下10条表达'), 'dossier replaces the list instead of stacking it');
  for (let n = 0; n < 2; n++) { await button(tree, '下10个来源').props.onClick(); await flush(); tree = render(); }
  assert.equal(values[0].learning.focus.sources.length, 5); assert.match(text(pane(tree, 'bili-learning-dossier')), /公开证据24/);
  await button(pane(tree, 'bili-learning-dossier'), '下10条变更').props.onClick(); await flush(); tree = render(); assert.equal(values[0].learning.events.length, 2);
  await button(tree, '返回表达列表').props.onClick(); await flush(); tree = render(); button(tree, '复盘').props.onClick(); tree = render();
  assert.ok(!pane(tree, 'bili-review-filter').props.open);
  for (let n = 0; n < 2; n++) { await button(tree, '下5份复盘').props.onClick(); await flush(); tree = render(); }
  assert.equal(values[0].learning.reviewPage.offset, 10); assert.equal(values[0].learning.reviews.length, 2);
  assert.ok(values[0].learning.reviews.some(r => r.id === reviewIds[0]), 'review older than the old seven-item window is reachable');
  await button(tree, '导出这份复盘到工作区').props.onClick(); await flush(); tree = render();
  const exported = calls.find(c => c.action === 'learning_export'); assert.ok(reviewIds.slice(0, 2).includes(exported.reviewId));
  assert.ok(existsSync(join(f.workspacePath, '.bilibili-harness', 'learning-reviews', '123', exported.reviewId + '.md')));
  assert.match(text(tree), /未重复调用模型/);
  const dates = flat(pane(tree, 'bili-review-filter')).filter(n => n?.type === 'input');
  dates[0].props.onChange({ target: { value: '2026-09-10' } }); tree = render();
  await button(tree, '应用复盘筛选').props.onClick(); await flush(); tree = render();
  assert.equal(values[0].learning.reviewPage.offset, 0); assert.equal(values[0].learning.reviewPage.total, 3);
  assert.equal(f.counters.prompt, 0); assert.equal(f.counters.read, 0); assert.equal(f.counters.create, 1);
  assert.equal(f.store.get('binding').sessionId, binding.sessionId);
  assert.ok(calls.every(c => ['status', 'learning_export'].includes(c.action)));
});

test('history UI previews batch cleanup and sends no deletion until the second explicit click', async t => {
  const f = fixture(t); await f.bind();
  for (const requestId of ['ui-batch-record-a', 'ui-batch-record-b']) {
    await f.controller.start({ requestId, bvid: 'BV1xx411c7mD' }); await f.controller.idle();
  }
  let plugin, settings, stateIndex = 0, refIndex = 0;
  const values = [], refs = [], effects = [], calls = [];
  const React = { createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity) }),
    useState(initial) { const i = stateIndex++; if (!(i in values)) values[i] = initial; return [values[i], v => { values[i] = typeof v === 'function' ? v(values[i]) : v; }]; },
    useRef(initial) { const i = refIndex++; return refs[i] ||= { current: initial }; }, useEffect(fn) { effects.push(fn); } };
  const scope = { window: { __ModuleLoader__: { load: definition => { plugin = definition.factory(() => React); } } },
    fetch: async (_url, options) => { const input = JSON.parse(options.body); calls.push(input); return Response.json({ ok: true, value: await f.controller.dispatch(input) }); },
    setTimeout, clearTimeout, setInterval: () => 1, clearInterval() {}, AbortController, Response, crypto: { randomUUID: () => 'ui-batch-action' } };
  scope.globalThis = scope; runInNewContext(readFileSync('client.js', 'utf8'), scope);
  const slots = { inject: (_n, cb) => cb(), register: (_o, fn) => { settings = fn; } };
  plugin.apply({ get: n => n === 'slots' ? slots : { openSession() {} } }); const panel = settings({});
  const render = () => { stateIndex = 0; refIndex = 0; effects.length = 0; return panel.type(panel.props); };
  const flat = n => n && typeof n === 'object' ? [n, ...n.children.flatMap(flat)] : [n];
  const button = (tree, label) => flat(tree).find(n => n?.type === 'button' && n.children.includes(label));
  const flush = () => new Promise(resolve => setImmediate(resolve));
  render(); const cleanup = effects[0](); await flush();
  let tree = render(); button(tree, '记录').props.onClick(); tree = render();
  assert.equal(button(tree, '确认清理这批记录与笔记'), undefined);
  await button(tree, '预览本次批量清理').props.onClick(); await flush(); tree = render();
  assert.equal(f.store.count(), 2); assert.equal(calls.filter(c => c.action === 'history_confirm_delete').length, 0);
  await button(tree, '确认清理这批记录与笔记').props.onClick(); await flush();
  assert.equal(f.store.count(), 0); assert.equal(f.counters.prompt, 2); assert.equal(f.counters.read, 2);
  assert.equal(calls.filter(c => c.action === 'history_confirm_delete').length, 1); cleanup();
});

test('TAG browse controls allow a tag-only round and keep the new options collapsed', () => {
  let plugin, settings, index = 0;
  const config = { ...DEFAULT_CONFIG, browseTagEnabled: true, browseTags: ['asmr'], keywords: [] };
  const status = { config, binding: { phase: 'active' }, workspaces: [], runs: [], total: 0, install: { state: 'ready' } };
  const values = [status, config, '', 0, '', false, '', '', null, '', 'browse', {}, '', 0, '', null, '', null, '', {}, '', 0, '', 'base'];
  const React = { createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity) }),
    useState(initial) { const i = index++; if (!(i in values)) values[i] = initial; return [values[i], v => { values[i] = v; }]; },
    useRef: current => ({ current }), useEffect() {} };
  const slots = { inject: (_n, cb) => cb(), register: (_o, fn) => { settings = fn; } };
  runInNewContext(readFileSync('client.js', 'utf8'), { window: { __ModuleLoader__: { load: m => { plugin = m.factory(() => React); } } }, crypto: { randomUUID: () => 'tag-render-only' } });
  plugin.apply({ get: n => n === 'slots' ? slots : { openSession() {} } }); const panel = settings({});
  const flat = n => n && typeof n === 'object' ? [n, ...n.children.flatMap(flat)] : [n];
  const render = () => { index = 0; return flat(panel.type(panel.props)); };
  let nodes = render();
  assert.equal(nodes.find(n => n?.type === 'button' && n.children.includes('立即运行一轮')).props.disabled, false);
  const options = nodes.find(n => n?.type === 'details' && flat(n).some(c => c?.type === 'summary' && c.children.some(s => typeof s === 'string' && s.startsWith('TAG标签限制'))));
  assert.ok(options); assert.ok(!options.props.open);
  values[5] = true; nodes = render();
  assert.equal(nodes.find(n => n?.type === 'button' && n.children.includes('立即运行一轮')).props.disabled, true);
});

test('weekly UI keeps settings collapsed and disables review/publication as soon as local text is edited', () => {
  let plugin, settings, index = 0;
  const config = { ...DEFAULT_CONFIG };
  const draft = { id: 'weekly-' + 'a'.repeat(32), revision: 'r1', state: 'approved', body: '已审核的周总结正文。', accountUid: '123',
    weekKey: '2026-10-19', images: [{ hash: 'b'.repeat(64), thumbnail: 'data:image/jpeg;base64,AA==', width: 100, height: 100 }],
    mentions: [], sources: [], approval: { revision: 'r1' } };
  const status = { config, binding: { phase: 'active' }, workspaces: [], runs: [], total: 0, install: { state: 'ready' },
    weekly: { drafts: [draft], busy: false, budget: { generations: 1, generationLimit: 2, publications: 0, publicationLimit: 1 } } };
  const values = [status, config, '', 0, '', false, '', '', null, '', 'weekly', {}, '', 0, '', null, '', null, '', {}, '', 0, '', 'base'];
  const React = { createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity) }),
    useState(initial) { const i = index++; if (!(i in values)) values[i] = initial; return [values[i], v => { values[i] = typeof v === 'function' ? v(values[i]) : v; }]; },
    useRef: current => ({ current }), useEffect() {} };
  const slots = { inject: (_n, cb) => cb(), register: (_o, fn) => { settings = fn; } };
  runInNewContext(readFileSync('client.js', 'utf8'), { window: { __ModuleLoader__: { load: m => { plugin = m.factory(() => React); } } }, crypto: { randomUUID: () => 'render-only' } });
  plugin.apply({ get: n => n === 'slots' ? slots : { openSession() {} } }); const panel = settings({});
  const flat = n => n && typeof n === 'object' ? [n, ...n.children.flatMap(flat)] : [n];
  const render = () => { index = 0; return flat(panel.type(panel.props)).find(n => n?.props?.id === 'bili-tab-weekly'); };
  let pane = render(), nodes = flat(pane);
  const button = label => nodes.find(n => n?.type === 'button' && n.children.includes(label));
  assert.equal(pane.props.hidden, false); assert.equal(button('确认发布这条动态').props.disabled, false);
  assert.ok(nodes.filter(n => n?.type === 'details').every(n => !n.props.open));
  nodes.find(n => n?.type === 'textarea').props.onChange({ target: { value: '正在修改，尚未保存的正文。' } });
  pane = render(); nodes = flat(pane);
  assert.equal(button('确认发布这条动态').props.disabled, true);
  assert.equal(button('审核当前图文').props.disabled, true);
  assert.equal(button('保存文案与提及').props.disabled, false);
  assert.equal(nodes.find(n => n?.type === 'input' && n.props.type === 'file').props.disabled, true);
});

test('unknown weekly UI only offers readonly verification and never resubmits on refresh or checking', async () => {
  let plugin, settings, index = 0; const calls = [], config = { ...DEFAULT_CONFIG };
  const draft = { id: 'weekly-' + 'a'.repeat(32), revision: 'r1', state: 'unknown', body: '待核对的图文。', accountUid: '123',
    weekKey: '2026-10-19', images: [], mentions: [], sources: [], approval: null };
  const status = { config, binding: { phase: 'active' }, workspaces: [], runs: [], total: 0, install: { state: 'ready' },
    weekly: { drafts: [draft], budget: { generations: 1, generationLimit: 2, publications: 1, publicationLimit: 1 } } };
  const values = [status, config, '', 0, '', false, '', '', null, '', 'weekly', {}, '', 0, '', null, '', null, '', {}, '', 0, '', 'base'];
  const React = { createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity) }),
    useState(initial) { const i = index++; if (!(i in values)) values[i] = initial; return [values[i], v => { values[i] = typeof v === 'function' ? v(values[i]) : v; }]; },
    useRef: current => ({ current }), useEffect() {} };
  const scope = { window: { __ModuleLoader__: { load: m => { plugin = m.factory(() => React); } } },
    fetch: async (_url, options) => { const input = JSON.parse(options.body); calls.push(input); return Response.json({ ok: true, value: input.action === 'status' ? status : { message: '样本未见，原状态保留。' } }); },
    setTimeout, clearTimeout, AbortController, Response, crypto: { randomUUID: () => 'readonly-ui' } };
  scope.globalThis = scope; runInNewContext(readFileSync('client.js', 'utf8'), scope);
  const slots = { inject: (_n, cb) => cb(), register: (_o, fn) => { settings = fn; } };
  plugin.apply({ get: n => n === 'slots' ? slots : { openSession() {} } }); const panel = settings({});
  const flat = n => n && typeof n === 'object' ? [n, ...n.children.flatMap(flat)] : [n];
  const render = () => { index = 0; return flat(panel.type(panel.props)).find(n => n?.props?.id === 'bili-tab-weekly'); };
  let nodes = flat(render());
  assert.equal(calls.length, 0);
  assert.equal(nodes.find(n => n?.type === 'button' && n.children.includes('确认发布这条动态')), undefined);
  await nodes.find(n => n?.type === 'button' && n.children.includes('只读核对发布结果')).props.onClick();
  assert.equal(calls.filter(c => c.action === 'weekly_verify').length, 1);
  assert.equal(calls.filter(c => c.action === 'weekly_publish').length, 0);
  draft.state = 'not_submitted'; nodes = flat(render());
  assert.match(nodes.filter(n => typeof n === 'string').join(''), /动态未提交/);
  assert.equal(nodes.find(n => n?.type === 'button' && n.children.includes('确认发布这条动态')), undefined);
});

test('all three comment modes are directly visible and survive save and reopening the settings panel', async t => {
  const f = fixture(t); await f.bind();
  let plugin, settings, stateIndex = 0, refIndex = 0;
  const values = [], refs = [], effects = [], calls = [];
  const React = { createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity) }),
    useState(initial) { const i = stateIndex++; if (!(i in values)) values[i] = initial; return [values[i], v => { values[i] = typeof v === 'function' ? v(values[i]) : v; }]; },
    useRef(initial) { const i = refIndex++; return refs[i] ||= { current: initial }; }, useEffect(fn) { effects.push(fn); } };
  const scope = { window: { __ModuleLoader__: { load: module => { plugin = module.factory(() => React); } } },
    fetch: async (_url, options) => {
      const input = JSON.parse(options.body); calls.push(input);
      return Response.json({ ok: true, value: await f.controller.dispatch(input) });
    }, setTimeout, clearTimeout, setInterval: () => 1, clearInterval() {}, AbortController, Response, crypto: { randomUUID: () => 'mode-test-request' } };
  scope.globalThis = scope; runInNewContext(readFileSync('client.js', 'utf8'), scope);
  const slots = { inject: (_n, cb) => cb(), register: (_o, fn) => { settings = fn; } };
  plugin.apply({ get: n => n === 'slots' ? slots : { openSession() {} } }); const panel = settings({});
  const render = () => { stateIndex = 0; refIndex = 0; effects.length = 0; return panel.type(panel.props); };
  const flat = n => n && typeof n === 'object' ? [n, ...n.children.flatMap(flat)] : [n];
  const text = n => flat(n).filter(x => typeof x === 'string').join('');
  const button = (tree, label) => flat(tree).find(n => n?.type === 'button' && text(n) === label);
  const radios = tree => flat(tree).filter(n => n?.props?.role === 'radio');
  const flush = () => new Promise(resolve => setImmediate(resolve));
  const reopen = async () => {
    values.length = 0; refs.length = 0; render(); const cleanup = effects[0](); await flush();
    let tree = render(); button(tree, '互动').props.onClick(); tree = render(); return { tree, cleanup };
  };
  let current = await reopen();
  assert.equal(radios(current.tree).length, 3, 'three choices must be readable without opening a native popup');
  assert.deepEqual(radios(current.tree).map(n => n.props.value), ['preview', 'manual', 'auto']);
  assert.equal(radios(current.tree).filter(n => n.props['aria-checked']).length, 1);
  assert.equal(radios(current.tree).find(n => n.props['aria-checked']).props.value, 'preview');
  let focused = -1, prevented = false;
  radios(current.tree)[0].props.onKeyDown({ key: 'ArrowRight', preventDefault() { prevented = true; },
    currentTarget: { parentElement: { querySelectorAll: () => [0, 1, 2].map(i => ({ focus() { focused = i; } })) } } });
  current.tree = render(); assert.equal(focused, 1); assert.equal(prevented, true);
  assert.equal(radios(current.tree).find(n => n.props['aria-checked']).props.value, 'manual');
  for (const mode of ['manual', 'auto', 'preview']) {
    radios(current.tree).find(n => n.props.value === mode).props.onClick(); current.tree = render();
    assert.equal(radios(current.tree).find(n => n.props['aria-checked']).props.value, mode);
    await button(current.tree, '保存评论设置').props.onClick(); await flush();
    assert.equal(f.store.config().commentMode, mode, 'the real controller writes the chosen mode to SQLite');
    current.cleanup(); current = await reopen();
    assert.equal(radios(current.tree).find(n => n.props['aria-checked']).props.value, mode, 'the saved mode is restored on a new panel mount');
  }
  assert.equal(f.counters.read, 0); assert.equal(f.counters.prompt, 0);
  assert.ok(calls.every(c => ['status', 'configure'].includes(c.action)), 'changing modes alone must not send or evaluate anything');
  values[0] = { ...await f.controller.status(), active: { id: 'busy-for-ui-only' } }; current.tree = render();
  assert.ok(radios(current.tree).every(n => n.props.disabled), 'an active evaluation still prevents changing its configuration');
  current.cleanup();
});

test('persona UI separates user base from autonomous iteration and offers advisory input without approval workflow', () => {
  let plugin, settings, index = 0;
  const config = { ...DEFAULT_CONFIG, learningEnabled: true, learningAdvice: '试试更简短' };
  const status = { config, binding: { phase: 'active' }, workspaces: [], runs: [], total: 0, install: { state: 'ready' },
    learning: { enabled: true, iteration: { version: 2, traits: [{ id: 'trait-1', text: '偏好先引用依据再评价。', reason: '与旧记忆比较后的选择', sourceIds: ['source-1'] }] },
      entries: [], total: 0, counts: {}, reviews: [], events: [], notice: '' } };
  const values = [status, config, '', 0, '', false, '', '', null, '', 'persona', {}, '', 0, '', null, '', null, '', {}, '', 0, '', 'base'];
  const React = { createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity) }),
    useState: () => { const i = index++; return [values[i], v => { values[i] = v; }]; }, useRef: current => ({ current }), useEffect() {} };
  const slots = { inject: (_n, cb) => cb(), register: (_o, fn) => { settings = fn; } };
  runInNewContext(readFileSync('client.js', 'utf8'), { window: { __ModuleLoader__: { load: m => { plugin = m.factory(() => React); } } }, crypto: { randomUUID: () => 'render-only' } });
  plugin.apply({ get: n => n === 'slots' ? slots : { openSession() {} } }); const panel = settings({});
  const flat = n => n && typeof n === 'object' ? [n, ...n.children.flatMap(flat)] : [n];
  let tree = panel.type(panel.props), nodes = flat(tree);
  assert.equal(nodes.find(n => n?.props?.id === 'bili-tab-persona').props.hidden, false);
  assert.equal(nodes.find(n => n?.props?.id === 'bili-iteration').props.hidden, true);
  nodes.find(n => n?.type === 'button' && n.children.includes('迭代')).props.onClick(); index = 0;
  tree = panel.type(panel.props); nodes = flat(tree); const text = nodes.filter(n => typeof n === 'string').join('');
  assert.match(text, /基础人设 · 由你填写/); assert.match(text, /迭代人设 · 大肥鱼自主选择/);
  assert.match(text, /不需要逐条批准/); assert.match(text, /每天结束后与过去/);
  const iteration = nodes.find(n => n?.props?.id === 'bili-iteration'); assert.equal(iteration.props.hidden, false);
  assert.equal(flat(iteration).filter(n => n?.type === 'textarea').length, 1, 'only advice is editable in the iteration section');
  assert.equal(flat(iteration).find(n => n?.type === 'textarea').props.value, config.learningAdvice);
  assert.equal(nodes.filter(n => n?.type === 'button' && n.children.some(c => typeof c === 'string' && /批准|应用人设|采纳建议/.test(c))).length, 0);
  assert.equal(nodes.find(n => n?.props?.id === 'bili-tab-persona').props.hidden, true);
  assert.equal(nodes.find(n => n?.props?.id === 'bili-learning-settings').props.hidden, true);
  nodes.find(n => n?.type === 'button' && n.props.role === 'tab' && n.children.includes('设置')).props.onClick(); index = 0;
  tree = panel.type(panel.props); nodes = flat(tree);
  assert.equal(nodes.find(n => n?.props?.id === 'bili-learning-settings').props.hidden, false);
  assert.equal(nodes.find(n => n?.props?.id === 'bili-learning-expressions').props.hidden, true);
  assert.equal(nodes.find(n => n?.props?.id === 'bili-learning-reviews').props.hidden, true);
  const save = nodes.find(n => n?.type === 'button' && n.children.includes('保存学习设置'));
  assert.ok(save); assert.ok(!flat(nodes.find(n => n?.props?.id === 'bili-iteration')).includes(save), 'save stays outside the scrolling pane');
});

test('browse panel renders the scheduler waiting explanation and configured timezone beside the date', () => {
  let plugin, settings, index = 0;
  const config = { ...DEFAULT_CONFIG, autoEnabled: true, activityEnd: '12:00', timeZone: 'Asia/Singapore' };
  const message = '当前不在活动时段 09:00～12:00（Asia/Singapore），等待下一个活动窗口。';
  const status = { config, binding: { phase: 'active' }, workspaces: [], runs: [], total: 0, install: { state: 'ready' },
    browsing: { enabled: true, paused: false, nextRunAt: '2026-10-24T01:00:00.000Z',
      budget: { rounds: 1, roundLimit: 3, analyses: 2, analysisLimit: 6, uniqueVideos: 2, zone: config.timeZone },
      schedule: { code: 'activity', message, now: '2026-10-23T06:10:00Z', timeZone: config.timeZone } } };
  const values = [status, config, '', 0, '', false, '', '', null, '', 'browse', {}, '', 0, '', null, '', null, '', {}, ''];
  const React = { createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity) }),
    useState: () => [values[index++], () => {}], useRef: current => ({ current }), useEffect() {} };
  const slots = { inject: (_n, cb) => cb(), register: (_o, fn) => { settings = fn; } };
  runInNewContext(readFileSync('client.js', 'utf8'), { window: { __ModuleLoader__: { load: m => { plugin = m.factory(() => React); } } }, crypto: { randomUUID: () => 'render-only' } });
  plugin.apply({ get: n => n === 'slots' ? slots : { openSession() {} } }); const panel = settings({});
  const flat = n => n && typeof n === 'object' ? [n, ...n.children.flatMap(flat)] : [n];
  const tree = panel.type(panel.props), text = flat(tree).filter(n => typeof n === 'string').join('');
  assert.ok(text.includes(message)); assert.match(text, /下次自动运行/); assert.match(text, /当前时间：.*Asia\/Singapore/);
  assert.match(text, /首次开启会等待最近的活动窗口/);
});

test('public comment UI requires refreshed final text and a second explicit confirmation', async () => {
  let settings, plugin, stateIndex = 0, refIndex = 0;
  const values = [], refs = [], effects = [], calls = [];
  const config = { ...DEFAULT_CONFIG, commentMode: 'manual', commentMentionsEnabled: true,
    mentionTargets: [{ uid: '456', name: '指定对象', enabled: true, allowComment: true, allowDynamic: false }] };
  let d = { id: 'comment-ui-1', state: 'draft', revision: 'version-1', text: '有依据的评论。', mentions: [], accountUid: '123', bvid: 'BV1xx411c7mD' };
  const status = () => ({ config, binding: { phase: 'active' }, workspaces: [], active: null, install: { state: 'ready' }, total: 1,
    runs: [{ id: d.id, bvid: d.bvid, kind: 'video', state: 'preview', createdAt: new Date().toISOString(),
      preview: { should_comment: true, comment: '有依据的评论。', summary: '摘要', evaluation: '评价', reason: '理由' }, commentPublication: d }],
    comments: { mode: config.commentMode, paused: false, budget: { attempts: 0, limit: 5, mentionAttempts: 0, mentionLimit: 5 }, recent: [] } });
  const React = { createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity) }),
    useState(initial) { const i = stateIndex++; if (!(i in values)) values[i] = initial; return [values[i], v => { values[i] = typeof v === 'function' ? v(values[i]) : v; }]; },
    useRef(initial) { const i = refIndex++; return refs[i] ||= { current: initial }; }, useEffect(fn) { effects.push(fn); } };
  const scope = { window: { __ModuleLoader__: { load: module => { plugin = module.factory(() => React); } } },
    fetch: async (_url, options) => {
      const input = JSON.parse(options.body); calls.push(input);
      if (input.action === 'prepare_comment') {
        d = { ...d, revision: 'version-2', text: '有依据的评论。\n@指定对象 ', mentions: [{ uid: '456', name: '指定对象' }] };
        return Response.json({ ok: true, value: { publication: d, message: '已更新' } });
      }
      if (input.action === 'publish_comment') return Response.json({ ok: true, value: { message: '已提交' } });
      assert.equal(input.action, 'status'); return Response.json({ ok: true, value: status() });
    }, setTimeout, clearTimeout, setInterval: () => 1, clearInterval() {}, AbortController, Response, crypto: { randomUUID: () => 'request-id' } };
  scope.globalThis = scope; runInNewContext(readFileSync('client.js', 'utf8'), scope);
  const slots = { inject: (_n, cb) => cb(), register: (_o, fn) => { settings = fn; } };
  plugin.apply({ get: n => n === 'slots' ? slots : { openSession() {} } }); const panel = settings({});
  const render = () => { stateIndex = 0; refIndex = 0; effects.length = 0; return panel.type(panel.props); };
  const flat = n => n && typeof n === 'object' ? [n, ...n.children.flatMap(flat)] : [n];
  const text = n => flat(n).filter(x => typeof x === 'string').join('');
  const button = (tree, label) => flat(tree).find(n => n?.type === 'button' && text(n) === label);
  const flush = () => new Promise(resolve => setImmediate(resolve));
  render(); const cleanup = effects[0](); await flush(); let tree = render();
  const hour = flat(tree).find(n => n?.type === 'select' && n.props['aria-label'] === '活动结束小时');
  assert.ok(hour.children.some(n => n?.type === 'option' && n.props.value === '24'));
  hour.props.onChange({ target: { value: '24' } }); tree = render();
  const minute = flat(tree).find(n => n?.type === 'select' && n.props['aria-label'] === '活动结束分钟');
  assert.equal(minute.props.value, '00'); assert.equal(minute.props.disabled, true);
  assert.ok(text(tree).includes('12:00是中午，24:00是当天结束'));
  assert.ok(flat(tree).some(n => n?.props?.className === 'badge root-comment'));
  assert.ok(flat(tree).some(n => n?.props?.className === 'badge sub-comment'));
  assert.equal(flat(tree).find(n => n?.props?.id === 'bili-tab-interaction').props.hidden, true);
  button(tree, '互动').props.onClick(); tree = render();
  assert.equal(flat(tree).find(n => n?.props?.id === 'bili-tab-interaction').props.hidden, false);
  assert.equal(flat(tree).find(n => n?.props?.id === 'bili-tab-browse').props.hidden, true);
  for (const label of ['评论设置', '评论区关键词互动', '指定提及对象']) {
    const summary = flat(tree).find(n => n?.type === 'summary' && text(n) === label);
    assert.ok(summary); assert.equal(flat(tree).find(n => n?.type === 'details' && n.children.includes(summary)).props.open, undefined);
  }
  button(tree, '记录').props.onClick(); tree = render();
  const choice = flat(tree).find(n => n?.type === 'label' && text(n).includes('@指定对象')).children.find(n => n?.type === 'input');
  choice.props.onChange({ target: { checked: true } }); tree = render();
  assert.equal(button(tree, '发送这条评论').props.disabled, true, 'selection is not the current final preview yet');
  await button(tree, '更新最终预览').props.onClick(); await flush(); tree = render();
  assert.ok(text(tree).includes('有依据的评论。\n@指定对象 '));
  button(tree, '发送这条评论').props.onClick(); tree = render();
  assert.equal(calls.filter(c => c.action === 'publish_comment').length, 0, 'first click only reveals final confirmation');
  assert.ok(text(tree).includes('确认用 UID 123'));
  await button(tree, '确认发表').props.onClick(); await flush(); tree = render();
  assert.equal(calls.find(c => c.action === 'publish_comment').revision, 'version-2');
  config.mentionTargets = []; config.commentMentionsEnabled = false; values[0] = status(); tree = render();
  const removed = flat(tree).find(n => n?.type === 'label' && text(n).includes('已停用或移除')).children.find(n => n?.type === 'input');
  assert.equal(removed.props.disabled, false, 'removed or disabled targets can still be explicitly deselected');
  removed.props.onChange({ target: { checked: false } }); tree = render();
  assert.equal(button(tree, '发送这条评论').props.disabled, true, 'removal must update final preview before another send');
  config.commentMode = 'preview'; values[0] = status(); tree = render();
  assert.equal(button(tree, '发送这条评论').props.disabled, true, 'preview mode always disables publication');
  d = { ...d, state: 'sent', receipt: '555', mentionState: 'rendered' };
  values[0] = status(); tree = render();
  assert.match(text(tree), /公开可见性未确认/, 'a receipt or own-account lookup is not proof of public visibility');
  assert.ok(!flat(tree).some(n => n?.type === 'strong' && text(n) === '大肥鱼 · 已发表'));
  assert.equal(button(tree, '发送这条评论'), undefined, 'a visibility problem must not unlock a duplicate send');
  d.publicList = { state: 'not_in_sample', sampleCount: 3, checkedAt: Date.now() };
  values[0] = status(); tree = render();
  assert.match(text(tree), /当前账号可读，未登录最新评论样本未见（3条样本）/);
  assert.match(text(tree), /核对时间/);
  d.publicList = { state: 'found', sampleCount: 3, checkedAt: Date.now() };
  values[0] = status(); tree = render();
  assert.match(text(tree), /未登录最新评论样本中找到（3条样本）/);
  d.publicList = { state: 'unavailable', checkedAt: Date.now() };
  values[0] = status(); tree = render();
  assert.match(text(tree), /未登录列表检查暂不可用/);
  d = { ...d, state: 'unknown', receipt: '', receiptCandidate: '555', platformFeedback: { captured: true,
    toast: '评论已提交，审核通过后展示', needCaptcha: true, replyState: 17, invisible: true } };
  values[0] = status(); tree = render();
  assert.match(text(tree), /平台原提示：评论已提交，审核通过后展示/);
  assert.match(text(tree), /平台候选评论编号：555/);
  const feedbackSummary = flat(tree).find(n => n?.type === 'summary' && text(n) === '平台回执详情');
  assert.ok(feedbackSummary);
  assert.equal(flat(tree).find(n => n?.type === 'details' && n.children.includes(feedbackSummary)).props.open, undefined);
  assert.equal(button(tree, '发送这条评论'), undefined);
  cleanup();
});
test('settings transport timeout releases a stalled operation', async () => {
  const plugin = client(() => new Promise(() => {}));
  const outcome = await Promise.race([
    plugin.request({ action: 'reader_ping' }, { timeoutMs: 10 }).then(() => 'unexpected', () => 'timeout'),
    new Promise(resolve => setTimeout(() => resolve('still-stuck'), 80)),
  ]);
  assert.equal(outcome, 'timeout', 'A stalled request must not keep settings buttons locked');
});

test('owner fields save canonical identity and history deletion requires the explicit second click', async () => {
  let settings, plugin, index = 0, refIndex = 0, saved = { ...DEFAULT_CONFIG }, deleted = false, profile = null;
  const values = [], refs = [], effects = [], calls = [];
  const React = { createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity) }),
    useState(initial) { const i = index++; if (!(i in values)) values[i] = initial;
      return [values[i], v => { values[i] = typeof v === 'function' ? v(values[i]) : v; }]; },
    useRef(initial) { const i = refIndex++; return refs[i] ||= { current: initial }; }, useEffect(fn) { effects.push(fn); } };
  const slots = { inject: (_n, cb) => cb(), register: (_o, fn) => { settings = fn; } };
  const scope = { window: { __ModuleLoader__: { load: module => { plugin = module.factory(() => React); } } },
    fetch: async (_url, options) => {
      const input = JSON.parse(options.body); calls.push(input);
      if (input.action === 'configure') { saved = configOf(input.config, saved); return Response.json({ ok: true, value: { config: saved } }); }
      if (input.action === 'lookup_owner') {
        profile = { uid: '456', name: '查询到的真实昵称', face: '', profile: 'https://space.bilibili.com/456', checkedAt: new Date().toISOString() };
        return Response.json({ ok: true, value: profile });
      }
      if (input.action === 'delete_record') { deleted = true; return Response.json({ ok: true, value: { message: '已删除' } }); }
      assert.equal(input.action, 'status');
      return Response.json({ ok: true, value: { config: saved, ownerProfile: saved.ownerAccountUid === profile?.uid ? profile : null, binding: { phase: 'active', sessionId: 'original' },
        workspaces: [], runs: deleted ? [] : [{ id: 'delete-ui-record', kind: 'probe', state: 'completed', createdAt: new Date().toISOString() }],
        total: deleted ? 0 : 1, install: { state: 'ready' } } });
    }, setTimeout, clearTimeout, setInterval: () => 1, clearInterval() {}, AbortController, Response, crypto: { randomUUID: () => 'request-id' } };
  scope.globalThis = scope; runInNewContext(readFileSync('client.js', 'utf8'), scope);
  plugin.apply({ get: n => n === 'slots' ? slots : { openSession() {} } }); const panel = settings({});
  const render = () => { index = 0; refIndex = 0; effects.length = 0; return panel.type(panel.props); };
  const flat = node => node && typeof node === 'object' ? [node, ...node.children.flatMap(flat)] : [node];
  const text = node => flat(node).filter(x => typeof x === 'string').join('');
  const button = (tree, label) => flat(tree).find(n => n?.type === 'button' && text(n) === label);
  const labelInput = (tree, label) => flat(tree).find(n => n?.type === 'label' && text(n).includes(label)).children.find(n => n?.type === 'input');
  const flush = () => new Promise(resolve => setImmediate(resolve));
  render(); const cleanup = effects[0](); await flush(); let tree = render();
  await button(tree, '人设').props.onClick(); tree = render();
  labelInput(tree, '使用者 UID').props.onChange({ target: { value: 'https://space.bilibili.com/456/' } }); tree = render();
  await button(tree, '查询账号').props.onClick(); await flush(); tree = render();
  assert.ok(text(tree).includes('查询到的真实昵称'));
  assert.equal(labelInput(tree, '使用者昵称').props.value, '', 'lookup must not overwrite the chosen display name');
  labelInput(tree, '告诉 DeepSeek').props.onChange({ target: { checked: true } }); tree = render();
  await button(tree, '保存设置').props.onClick(); await flush(); tree = render();
  assert.equal(saved.ownerAccountUid, '456'); assert.equal(labelInput(tree, '使用者 UID').props.value, '456');
  assert.ok(text(tree).includes('查询到的真实昵称'), 'canonical save should retain the matched profile');
  labelInput(tree, '使用者 UID').props.onChange({ target: { value: '789' } }); tree = render();
  assert.equal(text(tree).includes('查询到的真实昵称'), false, 'editing UID must clear the previous person');
  assert.equal(calls.some(c => ['probe', 'analyze', 'dm_scan'].includes(c.action)), false);
  await button(tree, '记录').props.onClick(); tree = render();
  await button(tree, '删除这条记录').props.onClick(); tree = render();
  assert.equal(calls.some(c => c.action === 'delete_record'), false);
  await button(tree, '确认删除记录与笔记').props.onClick(); await flush();
  assert.equal(calls.find(c => c.action === 'delete_record').requestId, 'delete-ui-record');
  cleanup();
});
test('settings transport returns normal results and propagates safe server errors', async () => {
  const okay = client(async () => Response.json({ ok: true, value: { protocol: 1 } }));
  assert.equal((await okay.request({ action: 'reader_ping' })).protocol, 1);
  const failure = client(async () => Response.json({ ok: false, error: { message: '请先登录' } }, { status: 400 }));
  await assert.rejects(failure.request({ action: 'account' }), { message: '请先登录' });
});

test('settings installation progress follows refreshed status and gates QR creation', async () => {
  const values = [], refs = [], effects = [];
  let stateIndex = 0, refIndex = 0, interval, settings, definition;
  let install = { state: 'idle' };
  let savedConfig = {};
  let preparedModel = null;
  const React = {
    createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity) }),
    useState(initial) {
      const i = stateIndex++;
      if (!(i in values)) values[i] = initial;
      return [values[i], value => { values[i] = typeof value === 'function' ? value(values[i]) : value; }];
    },
    useRef(initial) { const i = refIndex++; return refs[i] ||= { current: initial }; },
    useEffect(effect) { effects.push(effect); },
  };
  const slots = {
    inject: (_name, callback) => callback(),
    register: (_options, render) => { settings = render; },
  };
  const scope = {
    window: { __ModuleLoader__: { load: module => { definition = module.factory(() => React); } } },
    fetch: async (_url, options) => {
      const input = JSON.parse(options.body);
      if (input.action === 'install_python') {
        install = { state: 'installing', stage: 'installing_packages' };
        return Response.json({ ok: true, value: install });
      }
      if (input.action === 'prepare_asr_model') {
        install = { state: 'installing', kind: 'model', stage: 'downloading_model', downloadedBytes: 5, totalBytes: 10 };
        return Response.json({ ok: true, value: install });
      }
      if (input.action === 'install_audio') {
        install = { state: 'installing', kind: 'audio', stage: 'downloading_packages', packageName: 'av',
          downloadedBytes: 1048576, totalBytes: 29360128, elapsedSeconds: 12 };
        return Response.json({ ok: true, value: install });
      }
      if (input.action === 'cancel_audio') {
        install = { state: 'cancelled', kind: 'audio', message: '准备已停止。' };
        return Response.json({ ok: true, value: { message: '已请求停止。' } });
      }
      if (input.action === 'audio_check') return Response.json({ ok: true,
        value: { ready: false, dependencies: true, modelFiles: false, message: '音频依赖已就绪，模型未配置。' } });
      assert.equal(input.action, 'status');
      return Response.json({ ok: true, value: {
        config: savedConfig, binding: { phase: 'active', sessionId: 'fixed-session' },
        runs: [], workspaces: [], total: 0, install, audio: { preparedModel, environment: { message: '旧音频就绪提示' } },
      } });
    },
    setTimeout, clearTimeout, AbortController, Response, crypto: { randomUUID: () => 'test-request' },
    setInterval: callback => { interval = callback; return 1; }, clearInterval() {},
  };
  scope.globalThis = scope;
  runInNewContext(readFileSync('client.js', 'utf8'), scope);
  definition.apply({ get: name => name === 'slots' ? slots : { openSession() {} } });
  const panel = settings({});
  const render = () => { stateIndex = 0; refIndex = 0; effects.length = 0; return panel.type(panel.props); };
  const flatten = node => node && typeof node === 'object' ? [node, ...node.children.flatMap(flatten)] : [node];
  const text = tree => flatten(tree).filter(value => typeof value === 'string').join('');
  const button = (tree, label) => flatten(tree).find(node => node?.type === 'button' && text(node).includes(label));
  const flush = () => new Promise(resolve => setImmediate(resolve));
  render();
  const cleanup = effects[0]();
  await flush();
  let tree = render();
  await button(tree, '准备 Python 依赖').props.onClick();
  await flush();
  tree = render();
  assert.equal(button(tree, '生成登录二维码').props.disabled, true);
  assert.match(text(tree), /正在准备 · 安装依赖/);
  install = { state: 'ready', version: '17.4.2' };
  await interval();
  tree = render();
  assert.equal(button(tree, '生成登录二维码').props.disabled, false);
  assert.match(text(tree), /已就绪 · bilibili-api-python 17.4.2/);
  assert.doesNotMatch(text(tree), /正在后台准备|正在准备/);
  const persona = flatten(tree).find(node => node?.type === 'textarea' && node.props.maxLength === 4000);
  persona.props.onChange({ target: { value: '尚未保存的人设内容' } });
  tree = render();
  await button(tree, '一键准备转写模型').props.onClick(); await flush();
  tree = render();
  assert.equal(button(tree, '生成登录二维码').props.disabled, true);
  assert.equal(button(tree, '停止准备模型').props.disabled, false);
  assert.match(text(tree), /下载转写模型/);
  savedConfig = { asrModelPath: 'C:\\models\\verified', asrDownloadModel: 'tiny', asrDownloadSource: 'official' };
  preparedModel = { path: savedConfig.asrModelPath };
  install = { state: 'ready', version: '17.4.2' }; // Another environment check may replace the install banner.
  await interval(); tree = render();
  assert.ok(flatten(tree).some(node => node?.type === 'input' && node.props.value === savedConfig.asrModelPath));
  assert.ok(flatten(tree).some(node => node?.type === 'textarea' && node.props.value === '尚未保存的人设内容'));
  assert.equal(button(tree, '生成登录二维码').props.disabled, false);
  await button(tree, '准备音频依赖').props.onClick(); await flush(); tree = render();
  assert.equal(button(tree, '准备音频依赖').props.disabled, true);
  assert.equal(button(tree, '检查音频环境').props.disabled, true);
  assert.equal(button(tree, '停止准备音频依赖').props.disabled, false);
  assert.match(text(tree), /下载音频依赖.*av.*1.0\/28.0 MiB.*已用 12 秒/);
  assert.doesNotMatch(text(tree), /旧音频就绪提示/);
  await button(tree, '停止准备音频依赖').props.onClick(); await flush(); tree = render();
  assert.equal(button(tree, '准备音频依赖').props.disabled, false);
  assert.equal(button(tree, '检查音频环境').props.disabled, false);
  await button(tree, '检查音频环境').props.onClick(); await flush(); tree = render();
  const dependencyNotice = flatten(tree).find(node => node?.type === 'p' && text(node) === '音频依赖已就绪，模型未配置。');
  assert.ok(dependencyNotice); assert.ok(!dependencyNotice.props.className.includes('error'));
  cleanup();
});
