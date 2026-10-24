import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

export const flatten = n => n && typeof n === 'object' ? [n, ...(n.children || []).flatMap(flatten)] : [n];
export const nodeText = n => flatten(n).filter(v => typeof v === 'string' || typeof v === 'number').join('');
export async function settingsHarness(controller) {
  let plugin, settings, stateIndex = 0, refIndex = 0, poll;
  const values = [], refs = [], effects = [], calls = [];
  const React = { createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity) }),
    useState(initial) { const i = stateIndex++; if (!(i in values)) values[i] = initial; return [values[i], v => { values[i] = typeof v === 'function' ? v(values[i]) : v; }]; },
    useRef(initial) { const i = refIndex++; return refs[i] ||= { current: initial }; }, useEffect(fn) { effects.push(fn); } };
  const scope = { window: { __ModuleLoader__: { load: m => { plugin = m.factory(() => React); } } },
    fetch: async (_url, options) => { const input = JSON.parse(options.body); calls.push(input); return Response.json({ ok: true, value: await controller.dispatch(input) }); },
    setTimeout, clearTimeout, setInterval: fn => { poll = fn; return 1; }, clearInterval() {}, AbortController, Response, crypto: { randomUUID: () => 'synthetic-settings-preview' } };
  scope.globalThis = scope; runInNewContext(readFileSync('client.js', 'utf8'), scope);
  plugin.apply({ get: name => name === 'slots' ? { inject: (_n, cb) => cb(), register: (_o, fn) => { settings = fn; } } : { openSession() {} } });
  const panel = settings({}), render = () => { stateIndex = 0; refIndex = 0; effects.length = 0; return panel.type(panel.props); };
  const flush = async () => { await new Promise(r => setImmediate(r)); await new Promise(r => setImmediate(r)); };
  render(); const close = effects[0](); await flush();
  return { render, calls, close, flush, async poll() { await poll(); await flush(); },
    button(root, text) { return flatten(root).find(n => n?.type === 'button' && nodeText(n) === text); } };
}
