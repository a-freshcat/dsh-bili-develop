import { createHash } from 'node:crypto';
import { assert, errorView } from './errors.mjs';
import { ownerUid } from './owner.mjs';
import { knowledgePolicyParts } from './knowledge-packs.mjs';
import { eligibility, rankedContacts } from './contacts.mjs';
import { inActivity } from './time.mjs';
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

export class Relationships {
  constructor(c) {
    this.c = c; this.s = c.store; this.db = this.s.db; this.contacts = c.social.contacts;
    this.db.exec('CREATE TABLE IF NOT EXISTS follow_attempts(id TEXT PRIMARY KEY,account_uid TEXT NOT NULL,uid TEXT NOT NULL,at_ms INTEGER NOT NULL,state TEXT NOT NULL,UNIQUE(account_uid,uid));');
    this.db.prepare("UPDATE follow_attempts SET state='unknown' WHERE state='sending'").run();
  }
  account() { return this.c.social.account || this.c.learning.account; }
  budget(account = this.account()) {
    const config = this.s.config(), w = this.s.window(config, this.c.now());
    const follow = this.db.prepare("SELECT COUNT(*) n,MAX(at_ms) last FROM follow_attempts WHERE account_uid=? AND at_ms>=? AND at_ms<? AND state<>'already'").get(account, w.start, w.end);
    const proactive = this.db.prepare("SELECT COUNT(*) n FROM private_attempts p JOIN private_messages m ON p.id=m.id AND p.account_uid=m.account_uid WHERE p.account_uid=? AND p.at_ms>=? AND p.at_ms<? AND json_extract(m.data,'$.kind')='proactive'").get(account, w.start, w.end);
    const generated = this.db.prepare("SELECT COUNT(*) n FROM private_messages WHERE account_uid=? AND at_ms>=? AND at_ms<? AND json_extract(data,'$.kind')='proactive'").get(account, w.start, w.end);
    return { follows: Number(follow.n), followLimit: config.autoFollowDailyLimit, lastFollowAt: follow.last,
      proactive: Number(proactive.n), proactiveGenerations: Number(generated.n), proactiveLimit: config.dmProactiveDailyLimit };
  }
  status() { const c = this.s.config(); return { autoFollow: c.autoFollowEnabled, proactive: c.dmProactiveEnabled,
    busy: !!this.busy, budget: this.budget(), notice: this.notice || '', followThreshold: 80, proactiveThreshold: 100 }; }
  configured(before, after) { if (!before.dmProactiveEnabled && after.dmProactiveEnabled) this.s.set('proactiveSince', this.c.now()); }
  policy(account) { const c = this.s.config(); return hash([c.persona, ownerUid(c), c.ownerAccountName, c.learningEnabled,
    c.learningEnabled ? this.c.learning.iteration(account).version : 0, ...knowledgePolicyParts(c)]); }
  allowed(person, proactive = false) {
    const config = this.s.config(), account = this.account();
    assert(person && person.uid !== account && !person.blocked && !person.userBlocked && !person.platformBlocked &&
      (person.fan || person.uid === ownerUid(config)), 'RELATION_NOT_ELIGIBLE', '对象不在认识范围或已屏蔽。');
    assert(proactive ? person.score === 100 && eligibility(person, this.contacts.all(account), config).allowed : person.score >= 80,
      'RELATION_SCORE', proactive ? '只有100分且仍符合聊天范围的对象可主动私信。' : '未达到80分，不自动关注。');
  }
  background(fn) {
    this.c.social.assertIdle(); assert(!this.busy && !this.s.openRound(), 'RUN_BUSY', '请等当前任务或浏览轮次结束。');
    this.busy = true; this.c.metadataBusy = true; this.c.metadataBusyMessage = '正在处理已开启的关系互动。';
    this.job = Promise.resolve().then(() => { if (!this.c.closed) return fn(); }).catch(e => { if (!this.c.closed) this.notice = errorView(e).message; })
      .finally(() => { this.busy = false; this.c.metadataBusy = false; this.c.metadataBusyMessage = ''; });
    return { message: '关系互动操作已提交，仍受隐私和额度控制。' };
  }
  async follow(person) {
    let config = this.s.config(); assert(config.autoFollowEnabled, 'FOLLOW_DISABLED', '80分自动关注未开启。'); this.allowed(person);
    const account = this.account(), key = account + ':' + person.uid;
    if (this.db.prepare('SELECT 1 FROM follow_attempts WHERE account_uid=? AND uid=?').get(account, person.uid)) return;
    const found = await this.c.reader().call('relationship_probe', { uid: person.uid, expected_account: account }); if (this.c.closed) return;
    assert(found?.accountUid === account && found.uid === person.uid && typeof found.following === 'boolean' && typeof found.fan === 'boolean' && typeof found.blocked === 'boolean', 'RELATION_TARGET', '关注对象或关系核对无效。');
    this.contacts.put(account, person.uid, { fan: found.fan, platformBlocked: found.blocked });
    this.s.set('followChecked:' + key, this.c.now());
    if (found.following) { this.notice = '对象已经关注，本次不计关注尝试。'; return { attempted: false }; }
    config = this.s.config(); assert(config.autoFollowEnabled && this.account() === account, 'FOLLOW_DISABLED', '账号或关注开关已变化。');
    this.allowed(this.contacts.person(account, person.uid));
    const b = this.budget(account), latest = this.db.prepare("SELECT MAX(at_ms) last FROM follow_attempts WHERE account_uid=? AND state<>'already'").get(account).last;
    assert(b.follows < config.autoFollowDailyLimit && (!latest || this.c.now() - latest >= config.autoFollowMinIntervalSeconds * 1000), 'FOLLOW_LIMIT', '自动关注达到每日上限（0关闭）或仍在冷却。');
    const id = 'follow-' + hash([account, person.uid]).slice(0, 40);
    this.s.transaction(() => { this.s.window(config, this.c.now(), true); this.db.prepare('INSERT INTO follow_attempts VALUES(?,?,?,?,?)').run(id, account, person.uid, this.c.now(), 'sending'); });
    try {
      const result = await this.c.reader().call('follow_user', { uid: person.uid, expected_account: account, owner_uid: ownerUid(config), enabled: true });
      if (this.c.closed) return;
      assert(result?.accountUid === account && result.uid === person.uid, 'RELATION_TARGET', '关注返回账号或对象不匹配。');
      const state = result.confirmed === true ? result.alreadyFollowed === true && result.attempted === false ? 'already' : 'followed' : 'unknown';
      this.db.prepare('UPDATE follow_attempts SET state=? WHERE id=?').run(state, id);
      this.notice = state === 'already' ? '发送前已关注，未操作且不计次数。' : state === 'followed' ? '平台已核对关注状态。' : '关注结果未知，保留尝试，不自动重试。';
    } catch { if (!this.c.closed) { this.db.prepare("UPDATE follow_attempts SET state='unknown' WHERE id=?").run(id); this.notice = '关注未确认，保留尝试，不自动重试。'; } }
    return { attempted: true };
  }
  async prepareProactive(person) {
    const config = this.s.config(), account = this.account();
    assert(config.dmProactiveEnabled && !this.c.social.paused, 'PROACTIVE_DISABLED', '每日主动私信关闭或私信已暂停。'); this.allowed(person, true);
    const w = this.s.window(config, this.c.now()), id = 'hello-' + hash([account, person.uid, w.start]).slice(0, 40);
    if (this.contacts.message(id) || this.s.run(id)) return;
    const b = this.contacts.budget(account, person.uid, config, this.c.now());
    assert(this.budget(account).proactiveGenerations < config.dmProactiveDailyLimit && b.replies < b.replyLimit && b.personReplies < b.personLimit && b.evaluations < b.evaluationLimit,
      'PROACTIVE_LIMIT', '主动私信或总私信/评价额度已用完（0关闭）。');
    const binding = await this.c.host.requireBinding(); if (this.c.closed) return;
    assert(!binding.running, 'SESSION_BUSY', '等待原对话空闲。');
    const found = await this.c.reader().call('dm_proactive_probe', { expected_account: account, uid: person.uid }); if (this.c.closed) return;
    assert(found?.accountUid === account && found.uid === person.uid && /^[a-f0-9]{64}$/.test(found.threadVersion || '') && Number.isSafeInteger(found.latestAt) && found.latestAt >= 0 && found.latestAt <= this.c.now() + 60000, 'PROACTIVE_THREAD', '最近私信状态无效。');
    this.contacts.put(account, person.uid, { fan: found.fan === true, platformBlocked: found.blocked === true }); this.allowed(this.contacts.person(account, person.uid), true);
    if (found.latestAt && this.c.now() - found.latestAt < 86400000) { this.s.set('proactiveAfter:' + account + ':' + person.uid, found.latestAt + 86400000); this.notice = '对方最近24小时已有会话互动，本次不主动打扰。'; return; }
    assert(this.account() === account && this.s.config().dmProactiveEnabled && !this.c.social.paused, 'PROACTIVE_DISABLED', '账号或开关已变化。');
    const m = this.contacts.reserveEvaluation({ id, kind: 'proactive', platformId: '', accountUid: account, uid: person.uid, text: '', receivedAt: this.c.now(), state: 'evaluating',
      dayEnd: w.end, threadVersion: found.threadVersion, draftPolicy: this.policy(account) }, config, this.c.now());
    const reserved = this.s.start({ id, kind: 'dm_proactive', sessionId: binding.sessionId, accountUid: account, now: this.c.now() });
    this.s.update(id, { proactivePayload: { person: this.contacts.person(account, person.uid), messageId: m.id, isOwner: person.uid === ownerUid(config) } });
    if (reserved.fresh) { this.c.launch(id, () => this.c.execute(this.s.run(id))); await this.c.jobs.get(id); }
    if (!this.c.closed && this.contacts.message(id)?.state === 'draft') await this.send(id, true);
  }
  prompt(run, config) {
    return ['这是已获使用者开关许可的100分联系人每日主动私信草稿，不是回复新来信，不评价或提高好感分数，不自行发送。',
      '基础人设：' + config.persona, '接收者角色：' + (run.proactivePayload.isOwner ? '使用者' : '认识的粉丝'),
      '只做简短、自然、不施压的问候，可以不想打扰而不发送。不编造对方说过的话、现实经历或已看内容，不夹带其他联系人或私信资料。',
      '只返回JSON：' + JSON.stringify({ runId: run.id, should_send: true, reply: '最多' + config.dmMaxChars + '字的问候，不发送则空字符串', reason: '简短理由，最多300字' })].join('\n');
  }
  complete(run, raw) {
    let value; try { value = JSON.parse(String(raw).trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')); } catch { /* validated below */ }
    const m = this.contacts.message(run.proactivePayload.messageId), config = this.s.config();
    assert(value?.runId === run.id && typeof value.should_send === 'boolean' && typeof value.reply === 'string' && value.reply.length <= config.dmMaxChars &&
      (value.should_send ? value.reply.trim() : value.reply === '') && typeof value.reason === 'string' && value.reason.length <= 300, 'PROACTIVE_FORMAT', '主动问候格式无效，未采纳。');
    this.allowed(this.contacts.person(m.accountUid, m.uid), true);
    this.c.privacy.check(value.reply, { account: m.accountUid, recipient: m.uid });
    this.c.privacy.remember(run.id + ':output', run.sessionId, m.accountUid, m.uid, [value.reply]);
    this.contacts.saveMessage({ ...m, state: value.should_send ? 'draft' : 'skipped', draft: value.reply, evaluation: value.reason,
      reason: value.should_send ? '100分主动问候草稿，等待开关、隐私及最新会话核对。' : '本次不主动打扰。' });
    return this.s.update(run.id, { state: 'completed', waitReason: null, noteStatus: 'private' });
  }
  failed(run, reason) { if (run?.kind !== 'dm_proactive') return; const m = this.contacts.message(run.id); if (m?.state === 'evaluating') this.contacts.saveMessage({ ...m, state: 'failed', reason }); }
  assertSend(m, auto) {
    const config = this.s.config();
    assert(config.dmProactiveEnabled && !this.c.social.paused && m?.kind === 'proactive' && m.state === 'draft' && m.accountUid === this.account(), 'PROACTIVE_DISABLED', '主动私信未开启、已暂停或草稿已处理。');
    this.allowed(this.contacts.person(m.accountUid, m.uid), true);
    assert(this.c.now() < m.dayEnd && m.receivedAt >= this.s.get('proactiveSince', Infinity) && m.draftPolicy === this.policy(m.accountUid), 'PROACTIVE_STALE', '日期、人设或开关已变化，旧问候不发送。');
    assert(!auto || inActivity(this.c.now(), config), 'PROACTIVE_TIME', '等待活动时段。');
    const b = this.contacts.budget(m.accountUid, m.uid, config, this.c.now());
    assert(this.budget(m.accountUid).proactive < config.dmProactiveDailyLimit && b.replies < b.replyLimit && b.personReplies < b.personLimit && (!b.latest || this.c.now() - b.latest >= Math.max(86400, config.dmMinIntervalSeconds) * 1000), 'PROACTIVE_LIMIT', '主动私信达到额度或24小时冷却。');
    assert(m.draft?.trim() && m.draft.length <= config.dmMaxChars, 'PROACTIVE_TEXT', '主动问候草稿为空或超过当前限制。');
    this.c.privacy.check(m.draft, { account: m.accountUid, recipient: m.uid });
    this.c.privacy.gate('dm:' + m.id, m.draft, auto, this.c.privacy.requiresPrivateReview(m.accountUid, m.uid));
  }
  async send(id, auto = false) {
    let m = this.contacts.message(id); this.assertSend(m, auto);
    await this.c.host.requireBinding();
    const found = await this.c.reader().call('dm_proactive_probe', { expected_account: m.accountUid, uid: m.uid }); if (this.c.closed) return;
    assert(found?.accountUid === m.accountUid && found.uid === m.uid && found.threadVersion === m.threadVersion, 'PROACTIVE_STALE', '对方会话已变化，未主动发送旧问候。');
    this.contacts.put(m.accountUid, m.uid, { fan: found.fan === true, platformBlocked: found.blocked === true }); m = this.contacts.message(id); this.assertSend(m, auto);
    this.contacts.reserveSend(m, this.s.config(), this.c.now());
    try {
      const sent = await this.c.reader().call('dm_proactive_send', { expected_account: m.accountUid, uid: m.uid, owner_uid: ownerUid(this.s.config()),
        enabled: true, thread_version: m.threadVersion, reply: m.draft }); if (this.c.closed) return;
      const confirmed = sent?.accountUid === m.accountUid && sent.uid === m.uid && sent.confirmed === true;
      this.contacts.saveMessage({ ...this.contacts.message(id), state: confirmed ? 'sent' : 'unknown', reason: confirmed ? '平台已确认主动私信。' : '主动私信结果未知，不重发。' });
    } catch { if (!this.c.closed) this.contacts.saveMessage({ ...this.contacts.message(id), state: 'unknown', reason: '主动私信结果未知，保留计数，不重发。' }); }
  }
  sendManual(id, input) { return this.background(async () => { const m = this.contacts.message(id); assert(m, 'PROACTIVE_MISSING', '主动问候不存在。');
    this.c.privacy.review('dm:' + id, m.draft, input, this.c.privacy.requiresPrivateReview(m.accountUid, m.uid)); await this.send(id); }); }
  async process() {
    const account = this.account(); if (!account) return; const config = this.s.config(), people = this.contacts.all(account);
    if (config.autoFollowEnabled && this.budget(account).follows < config.autoFollowDailyLimit) {
      const latest = this.db.prepare("SELECT MAX(at_ms) last FROM follow_attempts WHERE account_uid=? AND state<>'already'").get(account).last;
      if (!latest || this.c.now() - latest >= config.autoFollowMinIntervalSeconds * 1000) {
        const person = people.find(p => p.score >= 80 && !p.blocked && !p.userBlocked && !p.platformBlocked && (p.fan || p.uid === ownerUid(config)) &&
          this.c.now() - this.s.get('followChecked:' + account + ':' + p.uid, 0) >= 86400000 && !this.db.prepare('SELECT 1 FROM follow_attempts WHERE account_uid=? AND uid=?').get(account, p.uid));
        if (person) { const result = await this.follow(person); if (result?.attempted !== false) return; }
      }
    }
    if (!config.dmProactiveEnabled || this.c.social.paused) return;
    const pending = this.contacts.recent(account).find(m => m.kind === 'proactive' && m.state === 'draft' && !m.autoBlocked);
    if (pending) {
      try { await this.send(pending.id, true); }
      catch (e) {
        const permanent = ['PROACTIVE_STALE', 'RELATION_SCORE', 'RELATION_NOT_ELIGIBLE'].includes(e.code);
        this.contacts.saveMessage({ ...this.contacts.message(pending.id), ...(permanent ? { state: 'skipped' } : {}),
          autoBlocked: true, reason: errorView(e).message });
        this.notice = errorView(e).message;
      }
      return;
    }
    if (this.budget(account).proactiveGenerations >= config.dmProactiveDailyLimit) return;
    const ranks = new Map(rankedContacts(people, config).map((p, i) => [p.uid, i]));
    const person = people.find(p => p.score === 100 && eligibility(p, people, config, ranks).allowed && this.c.now() >= this.s.get('proactiveAfter:' + account + ':' + p.uid, 0) && !this.contacts.message('hello-' + hash([account, p.uid, this.s.window(config, this.c.now()).start]).slice(0, 40)));
    if (person) await this.prepareProactive(person);
  }
  start() { this.timer = setInterval(() => this.tick(), 60000); this.timer.unref?.(); }
  tick() {
    const config = this.s.config();
    if (this.c.closed || this.busy || !(config.autoFollowEnabled || config.dmProactiveEnabled) || !inActivity(this.c.now(), config) || this.c.now() < this.s.get('relationshipNextPoll', 0)) return;
    try { this.c.social.assertIdle(); if (this.s.openRound()) return; this.s.set('relationshipNextPoll', this.c.now() + 300000); this.background(() => this.process()); } catch { /* waits for shared idle admission */ }
  }
  close() { clearInterval(this.timer); }
}
