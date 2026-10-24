import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { Store } from './src/store.mjs';
import { DshHost, service } from './src/host.mjs';
import { BiliReader, pythonFor, installPython, installAudio, downloadWhisperModel } from './src/python.mjs';
import { Controller } from './src/controller.mjs';
import { PluginError, errorView } from './src/errors.mjs';

export const name = 'bilibili-harness';
export const inject = ['connection', 'sessionController', 'workspaceRegistry', 'agents', 'sessionQuery', 'tools', 'agentPresets'];
export const API_PATH = '/api/bilibili-harness';
export function makeHandler(controller) {
  return async request => {
    try {
      if (request.method !== 'POST') throw new PluginError('METHOD', '仅支持 POST。', 405);
      const origin = request.headers.get('origin');
      if (origin && origin !== new URL(request.url).origin) throw new PluginError('ORIGIN', '请求来源无效。', 403);
      if (request.headers.get('sec-fetch-site') === 'cross-site') throw new PluginError('ORIGIN', '跨站请求已拒绝。', 403);
      if (!/^application\/json(?:\s*;\s*charset\s*=\s*utf-8)?\s*$/i.test(request.headers.get('content-type') || '')) {
        throw new PluginError('CONTENT_TYPE', '仅接受 JSON 请求。', 415);
      }
      const limit = 6 * 1024 * 1024;
      if (Number(request.headers.get('content-length')) > limit) throw new PluginError('REQUEST_TOO_LARGE', '请求超过大小限制。', 413);
      const chunks = []; let bytes = 0;
      if (request.body) {
        const stream = request.body.getReader();
        try { while (true) { const { value, done } = await stream.read(); if (done) break; bytes += value.byteLength;
          if (bytes > limit) { await stream.cancel(); throw new PluginError('REQUEST_TOO_LARGE', '请求超过大小限制。', 413); } chunks.push(value); } }
        finally { stream.releaseLock(); }
      }
      const body = Buffer.concat(chunks, bytes).toString('utf8');
      if (body.length > 6 * 1024 * 1024) throw new PluginError('REQUEST_TOO_LARGE', '请求超过大小限制。', 413);
      let input;
      try { input = JSON.parse(body); } catch {
        if (bytes > 65536) throw new PluginError('REQUEST_TOO_LARGE', '请求超过大小限制。', 413);
        throw new PluginError('INVALID_JSON', '请求不是有效 JSON。');
      }
      if (!input || typeof input !== 'object' || Array.isArray(input)) throw new PluginError('INVALID_JSON', '请求应为JSON对象。');
      if (bytes > 65536 && input?.action !== 'weekly_attach_image') throw new PluginError('REQUEST_TOO_LARGE', '请求超过大小限制。', 413);
      const result = await controller.dispatch(input);
      return Response.json({ ok: true, value: result }, { headers: { 'cache-control': 'no-store' } });
    } catch (error) {
      return Response.json({ ok: false, error: errorView(error) }, {
        status: error instanceof PluginError ? error.status : 500,
        headers: { 'cache-control': 'no-store' },
      });
    }
  };
}
export async function apply(ctx) {
  const packageDir = dirname(fileURLToPath(import.meta.url));
  const home = service(ctx, 'dshHomePath');
  const dataDir = typeof home === 'function' ? home('bilibili-harness') :
    join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'bilibili-harness');
  const store = new Store(join(dataDir, 'state.sqlite'));
  ctx.effect(() => () => store.close(), 'bilibili-harness: database');
  let reader;
  const resetReader = () => { reader?.close(); reader = undefined; };
  const host = new DshHost(ctx, store);
  await host.initialize();
  const controller = new Controller({
    store, host, resetReader,
    reader: () => reader ||= new BiliReader({
      python: pythonFor(store.config(), dataDir, packageDir),
      worker: join(packageDir, 'python', 'reader.py'), dataDir,
    }),
    install: options => installPython({ ...options, target: join(dataDir, '.venv'),
      requirements: join(packageDir, 'python', 'requirements.txt') }),
    installAudio: options => installAudio({ ...options,
      python: pythonFor(store.config(), dataDir, packageDir),
      temporary: join(dataDir, 'audio-setup'), requirements: join(packageDir, 'python', 'requirements-audio.txt') }),
    downloadModel: options => downloadWhisperModel({ ...options, python: pythonFor(store.config(), dataDir, packageDir),
      script: join(packageDir, 'python', 'model_setup.py'), modelsDir: join(dataDir, 'asr-models') }),
  });
  // This channel is authenticated by the Host. Do not mount a separate server
  // on webServer, and never publish credentials through settings/status.
  const connection = service(ctx, 'connection');
  ctx.effect(() => connection.fetch.register({
    path: API_PATH, methods: ['POST'], requestBody: 'buffered', fetch: makeHandler(controller),
  }), 'bilibili-harness: authenticated API');
  ctx.effect(() => () => controller.close(), 'bilibili-harness: dispose');
  controller.recover().finally(() => { if (!controller.closed) { controller.scheduler.start(); controller.social.start(); controller.comments.start(); controller.learning.start(); controller.weekly.start(); controller.feedback.start(); controller.relationships.start(); } }).catch(() => {});
}
