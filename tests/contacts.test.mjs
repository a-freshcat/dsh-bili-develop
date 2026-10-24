import test from 'node:test';
import assert from 'node:assert/strict';
import { uidOf, ownerContext } from '../src/owner.mjs';
import { eligibility, rankedContacts, privatePrompt, ownerTone } from '../src/contacts.mjs';
import { DEFAULT_CONFIG } from '../src/store.mjs';
import { configOf, previewPrompt } from '../src/decision.mjs';
import { fixture, BV } from './fixtures.mjs';

test('optional owner accepts canonical UID/profile, never a nickname or lookalike host', () => {
  assert.equal(uidOf(' https://space.bilibili.com/123456/?from=search '), '123456');
  assert.equal(uidOf('9007199254740993'), '9007199254740993');
  for (const uid of ['0001', '-1', '0', '大肥鱼', 'https://space.bilibili.com.evil.test/123',
    'https://evil@space.bilibili.com/123', 'https://space.bilibili.com/123/dynamic']) assert.throws(() => uidOf(uid));
  assert.throws(() => configOf({ ownerAccountEnabled: true }, DEFAULT_CONFIG));
  const config = configOf({ ownerAccountEnabled: true, ownerAccountUid: 'https://space.bilibili.com/456/', ownerAccountName: '用户本人' }, DEFAULT_CONFIG);
  assert.equal(config.ownerAccountUid, '456');
  assert.match(ownerContext(config, { ownerUid: '456' }), /"videoByOwner":true/);
  assert.match(ownerContext(config, { ownerUid: '999', owner: '用户本人' }), /"videoByOwner":false/);
  const off = { ...config, ownerAccountEnabled: false };
  assert.doesNotMatch(ownerContext(off), /456|用户本人/);
  assert.match(ownerContext(off), /不再作为当前身份/);
});

test('owner configuration persists without a new model turn, probe and video reuse one dialogue', async t => {
  const f = fixture(t, { evidence: { ownerUid: '456', owner: '用户本人' } });
  const binding = await f.bind();
  f.controller.configure({ ownerAccountEnabled: true, ownerAccountUid: 'https://space.bilibili.com/456/', ownerAccountName: '用户本人' });
  assert.equal(f.counters.prompt, 0);
  await f.controller.start({ requestId: 'owner-video-1', bvid: BV }); await f.controller.idle();
  assert.match(f.store.run('owner-video-1').promptText, /本视频由使用者发布：true/);
  assert.doesNotMatch(f.store.run('owner-video-1').promptText, /456|用户本人/);
  await f.controller.start({ requestId: 'owner-probe-1', kind: 'probe' }); await f.controller.idle();
  assert.match(f.store.run('owner-probe-1').promptText, /BILI_PROBE_OK/);
  assert.doesNotMatch(f.store.run('owner-probe-1').promptText, /456|用户本人/);
  f.controller.configure({ ownerAccountEnabled: false });
  assert.equal(f.store.config().ownerAccountUid, '456');
  const text = previewPrompt({ id: 'owner-off' }, { bvid: BV, text: '字幕', ownerUid: '456' }, f.store.config());
  assert.doesNotMatch(text, /用户本人|456/);
  assert.equal(f.counters.create, 1);
  assert.equal(f.store.get('binding').sessionId, binding.sessionId);
});

test('60 inclusive, exactly 100 ordinary contacts, deterministic tie and owner excluded', () => {
  const config = { ...DEFAULT_CONFIG, ownerAccountEnabled: true, ownerAccountUid: '9999' };
  const people = Array.from({ length: 102 }, (_, i) => ({ uid: String(i + 1), score: 60, fan: true, blocked: false }));
  people.push({ uid: '9999', score: 1, fan: false });
  assert.equal(eligibility(people[0], people, config).allowed, true);
  assert.equal(eligibility(people[99], people, config).rank, 100);
  assert.equal(eligibility(people[100], people, config).allowed, false);
  assert.equal(eligibility(people.at(-1), people, config).owner, true);
  assert.equal(rankedContacts(people, config).length, 102);
  assert.equal(eligibility({ ...people[0], score: 59 }, [], config).allowed, false);
  assert.equal(eligibility({ uid: '1234', score: 100, fan: false }, people, config).allowed, false);
  assert.equal(eligibility({ ...people.at(-1), blocked: true }, people, config).allowed, false);
  people[100].score = 80;
  assert.equal(eligibility(people[100], people, config).rank, 1);
  assert.equal(eligibility(people[99], people, config).allowed, false);
});

test('attitude exploration is optional, owner-specific and becomes sharper below60', () => {
  assert.equal(ownerTone(0, false), ownerTone(100, true));
  assert.match(ownerTone(59, true), /冷淡/);
  assert.match(ownerTone(39, true), /不耐烦/);
  assert.match(ownerTone(19, true), /尖锐/);
  const config = { ...DEFAULT_CONFIG, ownerAccountEnabled: true, ownerAccountUid: '1', ownerAttitudeEnabled: true };
  const run = { id: 'private-task', dmPayload: { person: { uid: '1', name: '用户', score: 20 }, isOwner: true,
    message: { id: 'm1', text: '收到的消息' } } };
  assert.match(privatePrompt(run, config), /明显不耐烦/);
  assert.doesNotMatch(privatePrompt({ ...run, dmPayload: { ...run.dmPayload, isOwner: false } }, config), /明显不耐烦/);
});

test('owner lookup shows verified public profile, persists display cache and changes no identity or model state', async t => {
  const calls = [];
  const f = fixture(t, { call: async (method, params) => {
    calls.push({ method, params });
    return { uid: '456', name: '实际B站昵称', face: 'http://i0.hdslb.com/bfs/face/test.jpg', credential: 'never-return' };
  } });
  const before = f.store.config();
  const value = await f.controller.dispatch({ action: 'lookup_owner', uid: 'https://space.bilibili.com/456/' });
  assert.deepEqual(calls, [{ method: 'user_info', params: { uid: '456' } }]);
  assert.equal(value.name, '实际B站昵称'); assert.match(value.face, /^https:/);
  assert.equal(value.profile, 'https://space.bilibili.com/456');
  assert.equal(value.credential, undefined); assert.deepEqual(f.store.config(), before);
  assert.equal(f.counters.create, 0); assert.equal(f.counters.prompt, 0);
  assert.equal((await f.controller.status()).ownerProfile, null);
  f.controller.configure({ ownerAccountUid: '456', ownerAccountName: '主人别名' });
  const status = await f.controller.status();
  assert.equal(status.ownerProfile.name, '实际B站昵称'); assert.equal(status.config.ownerAccountName, '主人别名');
  assert.equal(f.counters.read, 1, 'status refresh must not re-query the platform');
  f.controller.configure({ ownerAccountUid: '789' });
  assert.equal((await f.controller.status()).ownerProfile, null);
});

test('a mismatched or failed owner lookup never displays another UID and always unlocks metadata operations', async t => {
  const f = fixture(t, { call: async () => ({ uid: '999', name: '错误的人', face: 'https://evil.test/face' }) });
  await assert.rejects(f.controller.lookupOwner('456'), { code: 'OWNER_PROFILE' });
  assert.equal(f.store.get('ownerProfile'), null); assert.equal(f.controller.metadataBusy, false);
  await assert.rejects(f.controller.lookupOwner('https://evil.test/456'), { code: 'INVALID_UID' });
  assert.equal(f.counters.read, 1);
  const failed = fixture(t, { call: async () => { throw new Error('private network details'); } });
  await assert.rejects(failed.controller.lookupOwner('456'));
  assert.equal(failed.controller.metadataBusy, false);
});

test('in-flight owner lookup prevents reader replacement and cover work until its result is settled', async t => {
  let release;
  const f = fixture(t, { call: () => new Promise(resolve => { release = resolve; }) });
  const pending = f.controller.lookupOwner('456');
  assert.equal(f.controller.metadataBusy, true);
  assert.throws(() => f.controller.configure({ persona: '变更' }), { code: 'RUN_BUSY' });
  assert.throws(() => f.controller.refreshCovers(), { code: 'RUN_BUSY' });
  await assert.rejects(f.controller.lookupOwner('789'), { code: 'RUN_BUSY' });
  release({ uid: '456', name: '实际昵称', face: 'https://untrusted.test/face' });
  const result = await pending;
  assert.equal(result.face, ''); assert.equal(f.controller.metadataBusy, false);
});
