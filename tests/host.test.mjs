import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './fixtures.mjs';
import { DshHost } from '../src/host.mjs';

test('binding creates exactly one plugin session and leaves user session alone', async t => {
  const f = fixture(t);
  const first = await f.bind();
  const second = await f.bind();
  assert.equal(first.phase, 'active');
  assert.equal(first.sessionId, second.sessionId);
  assert.equal(f.counters.create, 1);
  assert.notEqual(first.sessionId, 'existing-user-session');
  assert.equal(f.workspace.sessionIds.length, 2);
  assert.equal(f.live.get(first.sessionId).ctx.tools.restricted, true);
});
test('simultaneous binding requests cannot create two identities', async t => {
  const f = fixture(t);
  await Promise.allSettled([f.bind(), f.bind()]);
  assert.equal(f.counters.create, 1);
  assert.equal(f.workspace.sessionIds.length, 2);
});
test('reload and unmount/re-attach recover original identity without create', async t => {
  const f = fixture(t), binding = await f.bind();
  f.workspace.sessionIds = ['existing-user-session'];
  const host = new DshHost(f.ctx, f.store);
  assert.equal((await host.health()).phase, 'repair');
  assert.equal((await host.bind(f.workspace.id)).sessionId, binding.sessionId);
  assert.equal(f.counters.create, 1);
});
test('lost creation acknowledgement recovers committed original session', async t => {
  const f = fixture(t, { createAfterCommitError: true });
  await assert.rejects(f.bind(), { code: 'BINDING_REPAIR' });
  const reserved = f.store.get('binding').sessionId;
  assert.equal((await f.bind()).sessionId, reserved);
  assert.equal(f.counters.create, 1);
});
test('failed creation before commit reserves identity and refuses silent replacement', async t => {
  const f = fixture(t, { createBeforeCommitError: true });
  await assert.rejects(f.bind(), { code: 'BINDING_REPAIR' });
  const before = f.store.get('binding').sessionId;
  await assert.rejects(f.bind(), { code: 'BINDING_REPAIR' });
  assert.equal(f.store.get('binding').sessionId, before);
  assert.equal(f.counters.create, 1);
});
test('missing, archived, changed path bindings fail closed without create', async t => {
  const f = fixture(t), first = await f.bind();
  f.ctx.workspaceRegistry.archivedSessionIds.push(first.sessionId);
  assert.equal((await f.host.health()).phase, 'archived');
  await assert.rejects(f.host.requireBinding(), { code: 'BINDING_NOT_READY' });
  await assert.rejects(f.bind(), { code: 'SESSION_ARCHIVED' });
  f.ctx.workspaceRegistry.archivedSessionIds.length = 0;
  f.sessions.delete(first.sessionId);
  assert.equal((await f.host.health()).phase, 'repair');
  await assert.rejects(f.bind(), { code: 'BINDING_REPAIR' });
  assert.equal(f.counters.create, 1);
});
test('scope-local tools block creation/prompt even when global mask is set', async t => {
  const f = fixture(t, { localTool: true });
  await assert.rejects(f.bind(), { code: 'SCOPE_NOT_READ_ONLY' });
  assert.equal(f.counters.prompt, 0);
});
test('legacy unstarted coding preset is changed on the same session before guard', async t => {
  const f = fixture(t, { legacyPreset: true });
  const binding = await f.bind();
  assert.equal(binding.phase, 'active');
  assert.equal(f.live.get(binding.sessionId).ctx.currentPreset, 'bilibili-harness-reader');
  assert.equal(f.counters.create, 1);
});
test('compaction keeps identity; unsupported compaction gives actionable error', async t => {
  const f = fixture(t), binding = await f.bind();
  await assert.rejects(f.host.compact(), { code: 'COMPACT_UNAVAILABLE' });
  f.ctx.compaction = { async compactNow(agent) {
    assert.equal(agent.id, binding.sessionId);
    return { summarySeq: 42, shadowedSeqs: [1, 2], shadowedTokenCount: 100 };
  } };
  assert.equal((await f.host.compact()).sessionId, binding.sessionId);
  assert.equal(f.counters.create, 1);
});

test('settings compaction uses the original agent scoped service', async t => {
  const f = fixture(t), binding = await f.bind();
  let calls = 0;
  f.live.get(binding.sessionId).ctx.compaction = { async compactNow(agent) {
    calls++;
    assert.equal(agent.id, binding.sessionId);
    return { summarySeq: 42, shadowedSeqs: [1, 2], shadowedTokenCount: 100 };
  } };
  const result = await f.host.compact();
  assert.equal(result.sessionId, binding.sessionId);
  assert.equal(calls, 1);
});

test('no compactable history is reported as a no-op', async t => {
  const f = fixture(t), binding = await f.bind();
  f.ctx.compaction = { async compactNow() { return null; } };
  const result = await f.host.compact();
  assert.equal(result.sessionId, binding.sessionId);
  assert.equal(result.compacted, false);
  assert.match(result.message, /没有可压缩/);
});

test('compaction resolves the isolated preset backend through the native registry', async t => {
  const f = fixture(t), binding = await f.bind();
  const engine = { async compactNow() { return { summarySeq: 42, shadowedSeqs: [1], shadowedTokenCount: 50 }; } };
  f.ctx.agentPresets.serviceFor = (agent, name) => {
    assert.equal(agent.id, binding.sessionId);
    assert.equal(name, 'compaction');
    return engine;
  };
  const result = await f.host.compact();
  assert.equal(result.compacted, true);
  assert.equal(result.summarySeq, 42);
  assert.equal(f.counters.create, 1);
});

function manualFailure(code, cause) {
  const error = new Error('manual compaction failed', { cause });
  error.name = 'ManualCompactionError';
  error.code = code;
  return error;
}

test('a larger native summary is a preserved-history result, not a generic failure', async t => {
  const f = fixture(t), binding = await f.bind();
  f.ctx.compaction = { async compactNow() {
    throw manualFailure('summary', new Error('summary is not smaller than the shadowed content (986 estimated framed tokens >= 685)'));
  } };
  const result = await f.host.compact();
  assert.equal(result.sessionId, binding.sessionId);
  assert.equal(result.compacted, false);
  assert.equal(result.outcome, 'summary_not_smaller');
  assert.match(result.message, /未能缩短|没有缩短/);
  assert.doesNotMatch(result.message, /压缩已完成|读取环境/);
  assert.equal(f.counters.create, 1);
});

test('classified native failures have safe actionable messages', async t => {
  const f = fixture(t); await f.bind();
  for (const code of ['busy', 'changed', 'cancelled', 'summary', 'commit', 'persistence']) {
    f.ctx.compaction = { async compactNow() { throw manualFailure(code, new Error('private diagnostic')); } };
    await assert.rejects(f.host.compact(), error => {
      assert.equal(error.code, 'COMPACT_' + code.toUpperCase());
      assert.doesNotMatch(error.message, /private diagnostic|读取环境/);
      return true;
    });
  }
});

test('a different summary failure is never misreported as harmless size rejection', async t => {
  const f = fixture(t); await f.bind();
  f.ctx.compaction = { async compactNow() { throw manualFailure('summary', new Error('provider unavailable')); } };
  await assert.rejects(f.host.compact(), { code: 'COMPACT_SUMMARY' });
});
