import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { Store } from '../src/store.mjs';
import { DshHost } from '../src/host.mjs';
import { Controller } from '../src/controller.mjs';

export const BV = 'BV1xx411c7mD';
export function fixture(t, options = {}) {
  mkdirSync(join(process.cwd(), 'desktop-m0-m1'), { recursive: true });
  const root = mkdtempSync(join(process.cwd(), 'desktop-m0-m1', 'test-'));
  const workspacePath = join(root, 'workspace'); mkdirSync(workspacePath);
  const store = new Store(join(root, 'state.sqlite'));
  const listeners = new Map(), live = new Map(), sessions = new Map();
  const counters = { create: 0, prompt: 0, read: 0, dispose: 0 };
  const workspace = { id: 'workspace-test', title: 'bilibili_test', path: workspacePath,
    sessionIds: ['existing-user-session'],
    async attachSession(id) { if (!this.sessionIds.includes(id)) this.sessionIds.push(id); } };
  const ctx = {
    on(name, fn) { listeners.set(name, fn); return () => listeners.delete(name); },
    get(name) { return this[name]; },
    workspaceRegistry: { list: () => [workspace], get: id => id === workspace.id ? workspace : undefined, archivedSessionIds: [] },
    agents: { get: id => live.get(id) },
    agentPresets: {
      composedPreset: ctx => ctx.currentPreset,
      async select(agent, preset) {
        agent.ctx.currentPreset = preset;
        if (options.legacyPreset) agent.ctx.legacyTool = false;
      },
    },
    sessionQuery: { async observeSession(id) {
      if (!sessions.has(id)) throw new Error('SESSION_QUERY_SESSION_NOT_FOUND');
      return { ...sessions.get(id), [Symbol.dispose]: () => counters.dispose++ };
    } },
    sessionController: {
      async create({ workspaceId, sessionId, agentPreset }) {
        counters.create++;
        if (options.createBeforeCommitError) throw new Error('creation unavailable');
        if (workspaceId !== workspace.id) throw new Error('wrong workspace');
        sessions.set(sessionId, { header: { cwd: workspace.path }, events: [] });
        await workspace.attachSession(sessionId);
        const tools = { restrict() { this.restricted = true; }, modeFor: () => 'native',
          wireSchemas: () => ({ schemas: options.localTool || agent.ctx.legacyTool ? [{ name: 'local_write' }] : [] }) };
        const agent = { id: sessionId, status: 'idle', whenIdle: async () => {},
          ctx: { tools, currentPreset: options.legacyPreset ? 'standard' : agentPreset,
            legacyTool: !!options.legacyPreset, systemPrompt: { section() {} }, on() {}, get(name) { return this[name]; } } };
        live.set(sessionId, agent);
        await listeners.get('agent/created')?.({ agent, source: 'created' });
        if (options.createAfterCommitError) throw new Error('connection lost after commit');
        return { sessionId };
      },
      async rename() {},
      async prompt(request) {
        counters.prompt++;
        const agent = live.get(request.sessionId);
        if (options.neverIdle) agent.whenIdle = () => new Promise(() => {});
        if (options.noResult) return;
        const text = request.content[0].text;
        const result = (typeof options.output === 'function' ? options.output(text, request.requestId) : options.output) || (text.includes('BILI_PROBE_OK') ? 'BILI_PROBE_OK ' + request.requestId :
          '```json\n' + JSON.stringify(preview(request.requestId)) + '\n```');
        const events = sessions.get(request.sessionId).events;
        const seq = events.length + 1;
        events.push(
          { seq, type: 'user/message', data: { turn: 3, source: { rpcId: request.requestId } } },
          { seq: seq + 1, type: 'assistant/message', data: { message: { content: [{ type: 'text', text: result }] } } },
          { seq: seq + 2, type: 'turn/end', data: { turn: 3, reason: { kind: options.aborted ? 'aborted' : 'completed' } } },
        );
      },
    },
  };
  const host = new DshHost(ctx, store);
  const evidence = { bvid: BV, title: '测试字幕材料', source: 'subtitle', coverage: 'complete',
    language: '中文', text: '测试字幕原文内容足够验证。', segments: [{ from: 0, to: 4, text: '测试字幕原文内容足够验证。' }],
    totalSegments: 1, accountUid: '123', readAt: new Date().toISOString() };
  const controller = new Controller({ store, host, modelTimeoutMs: 15, now: options.now || Date.now,
    reader: () => ({ async call(method, params) {
      counters.read++;
      if (options.call) return options.call(method, params);
      if (method === 'ping') return { protocol: 1, bilibiliApi: '17.4.2' };
      if (method !== 'read_video') return { status: 'logged_out' };
      if (options.readError) throw new Error('private sensitive error');
      return { ...evidence, ...options.evidence };
    } }),
  });
  t.after(() => {
    controller.close(); store.close();
    if (!root.startsWith(join(process.cwd(), 'desktop-m0-m1', 'test-'))) throw new Error('Unsafe test cleanup path');
    rmSync(root, { recursive: true, force: true });
  });
  return { root, workspacePath, workspace, store, ctx, host, controller, counters, sessions, live, evidence,
    async bind() { return host.bind(workspace.id); } };
}
export function preview(id) {
  return { runId: id, summary: '材料摘要', evaluation: '评价内容', interest: 0.8,
    should_comment: true, comment: '这个内容讲得很清楚。', reason: '有明确的原文依据。', evidence_quote: '测试字幕原文内容' };
}
