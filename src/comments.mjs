import { createHash } from 'node:crypto';
import { assert, errorView } from './errors.mjs';
import { bvidOf, requestIdOf, parsePreview } from './decision.mjs';
import { uidOf, ownerUid } from './owner.mjs';
import { inActivity } from './time.mjs';
import { knowledgePolicyParts } from './knowledge-packs.mjs';

const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const policy = c => hash([c.persona, ownerUid(c), c.ownerAccountName || '', c.commentMaxChars, ...knowledgePolicyParts(c)]);
const feedbackOf = value => {
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.captured !== true) return undefined;
  const result = { captured: true };
  if (typeof value.toast === 'string') result.toast = value.toast.replace(/https?:\/\/\S+/g, '[链接已省略]')
    .replace(/\b(sessdata|bili_jct|csrf(?:_token)?|access_key|access_token|refresh_token|cookie|authorization)\b\s*[:=]\s*[^\s,;]+/gi, '$1=[已省略]')
    .replace(/[\x00-\x1f\x7f]/g, ' ').trim().slice(0, 200);
  for (const k of ['needCaptcha', 'invisible']) if (typeof value[k] === 'boolean') result[k] = value[k];
  for (const k of ['replyState', 'successAction']) if (Number.isInteger(value[k]) && value[k] >= -(2 ** 31) && value[k] < 2 ** 31) result[k] = value[k];
  return result;
};
const exposed = d => d && Object.fromEntries(['id', 'state', 'text', 'mentions', 'revision', 'reason', 'receipt', 'mentionState', 'attemptedAt', 'accountUid', 'bvid', 'contentCleared', 'target', 'kind', 'confirmationSource', 'confirmedAt', 'publicList', 'platformFeedback', 'receiptCandidate']
  .filter(k => d[k] !== undefined).map(k => [k, d[k]]));
const revisionOf = d => hash([d.id, d.accountUid, d.bvid, d.text, d.mentions, d.policy, ...(d.target ? [d.target] : [])]);
const attempts = '(SELECT id,account_uid,bvid,round_key,text_hash,at_ms FROM comment_attempts UNION ALL SELECT id,account_uid,bvid,round_key,text_hash,at_ms FROM reply_attempts UNION ALL SELECT id,account_uid,bvid,round_key,text_hash,at_ms FROM account_reply_attempts)';
export class Comments {
  constructor(c) {
    this.c = c; this.store = c.store; this.db = c.store.db;
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS comment_drafts(id TEXT PRIMARY KEY,account_uid TEXT NOT NULL,bvid TEXT NOT NULL,state TEXT NOT NULL,data TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS comment_account_state ON comment_drafts(account_uid,state);
      CREATE TABLE IF NOT EXISTS comment_attempts(id TEXT PRIMARY KEY,account_uid TEXT NOT NULL,bvid TEXT NOT NULL,round_key TEXT NOT NULL,text_hash TEXT NOT NULL,at_ms INTEGER NOT NULL,UNIQUE(account_uid,bvid));
      CREATE INDEX IF NOT EXISTS comment_usage ON comment_attempts(account_uid,at_ms);
      CREATE TABLE IF NOT EXISTS reply_attempts(id TEXT PRIMARY KEY,account_uid TEXT NOT NULL,bvid TEXT NOT NULL,target_id TEXT NOT NULL,source_id TEXT NOT NULL,level TEXT NOT NULL,round_key TEXT NOT NULL,text_hash TEXT NOT NULL,at_ms INTEGER NOT NULL,UNIQUE(account_uid,bvid,target_id));
      CREATE INDEX IF NOT EXISTS reply_usage ON reply_attempts(account_uid,at_ms);
      CREATE TABLE IF NOT EXISTS account_reply_attempts(id TEXT PRIMARY KEY,account_uid TEXT NOT NULL,bvid TEXT NOT NULL,round_key TEXT NOT NULL,text_hash TEXT NOT NULL,at_ms INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS account_reply_usage ON account_reply_attempts(account_uid,at_ms);
      CREATE TABLE IF NOT EXISTS account_comments(id TEXT PRIMARY KEY,account_uid TEXT NOT NULL,resource_key TEXT NOT NULL,target_id TEXT NOT NULL,state TEXT NOT NULL,at_ms INTEGER NOT NULL,data TEXT NOT NULL,UNIQUE(account_uid,resource_key,target_id));
      CREATE TABLE IF NOT EXISTS mention_attempts(id TEXT NOT NULL,account_uid TEXT NOT NULL,uid TEXT NOT NULL,scope TEXT NOT NULL,at_ms INTEGER NOT NULL,PRIMARY KEY(id,uid));
      CREATE INDEX IF NOT EXISTS mention_usage ON mention_attempts(account_uid,at_ms);
    `);
    for (const row of this.db.prepare("SELECT data FROM comment_drafts WHERE state='sending'").all()) {
      const d = JSON.parse(row.data);
      this.save({ ...d, state: 'unknown', reason: '重启前发送结果未确认，不重发；可只读核对最近评论。' });
    }
  }
  get paused() { return this.store.get('commentsPaused', false); }
  requiresPrivacyReview() { return this.store.config().commentPrivacyMode !== 'content' && this.c.privacy.context().sharedPrivateContext; }
  get(id) { const row = this.db.prepare('SELECT data FROM comment_drafts WHERE id=?').get(id); return row ? JSON.parse(row.data) : null; }
  save(d, note = true) {
    this.db.prepare('INSERT INTO comment_drafts VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET state=excluded.state,data=excluded.data')
      .run(d.id, d.accountUid, d.bvid, d.state, JSON.stringify(d));
    if (this.store.run(d.id)) {
      this.store.update(d.id, { commentPublication: exposed(d) });
      if (note && !this.c.closed) this.c.finish(d.id, {});
    }
    return d;
  }
  published(view = {}) {
    assert(view && typeof view === 'object' && !Array.isArray(view) && Object.keys(view).every(k => ['offset', 'q', 'account'].includes(k)),
      'COMMENT_PAGE', '已发评论查询无效。');
    assert(Number.isInteger(view.offset ?? 0) && (view.offset ?? 0) >= 0 && (view.offset ?? 0) <= 1000000 &&
      typeof (view.q ?? '') === 'string' && (view.q ?? '').length <= 100 && (!view.account || typeof view.account === 'string'),
      'COMMENT_PAGE', '已发评论分页或搜索条件无效。');
    const account = this.c.social.account || this.store.get('commentAccount', '');
    const q = view.account && view.account !== account ? '' : (view.q || '').trim();
    const args = [account];
    let where = "d.account_uid=? AND d.state='sent'";
    if (q) {
      where += " AND (instr(d.bvid,?)>0 OR instr(COALESCE(json_extract(d.data,'$.text'),''),?)>0 OR instr(COALESCE(json_extract(r.data,'$.evidence.title'),''),?)>0)";
      args.push(q, q, q);
    }
    const from = ' FROM comment_drafts d LEFT JOIN runs r ON r.id=d.id WHERE ' + where;
    const total = Number(this.db.prepare('SELECT COUNT(*) n' + from).get(...args).n), pageSize = 10;
    const requested = view.account && view.account !== account ? 0 : view.offset || 0;
    const offset = Math.min(requested, Math.max(0, Math.floor((total - 1) / pageSize) * pageSize));
    const rows = this.db.prepare("SELECT d.data,json_extract(r.data,'$.evidence.title') title" + from + ' ORDER BY d.rowid DESC LIMIT ? OFFSET ?')
      .all(...args, pageSize, offset).map(row => ({ ...exposed(JSON.parse(row.data)), title: row.title || '' }));
    return { account, q, rows, total, offset, pageSize };
  }
  status(view = {}) {
    const accountUid = this.c.social.account || this.store.get('commentAccount', '');
    return { mode: this.store.config().commentMode, paused: this.paused, busy: !!this.busy, accountUid,
      budget: this.budget(accountUid), notice: this.notice || '', error: this.error || null, recoveryBvid: this.recoveryBvid || '',
      privacyMode: this.store.config().commentPrivacyMode, privacyReviewRequired: this.requiresPrivacyReview(), published: this.published(view),
      recent: this.db.prepare("SELECT data FROM comment_drafts WHERE account_uid=? AND state IN ('sent','unknown','failed','sending') ORDER BY rowid DESC LIMIT 10")
        .all(accountUid).map(row => exposed(JSON.parse(row.data))) };
  }
  context(account) { return this.db.prepare("SELECT data FROM comment_drafts WHERE account_uid=? AND state IN ('sent','unknown','failed') ORDER BY rowid DESC LIMIT 3")
    .all(account).map(row => { const d = JSON.parse(row.data); return { bvid: d.bvid, state: d.state, text: d.text, receipt: d.receipt || '',
      ...(d.state === 'sent' ? { publicVisibility: d.publicList?.state || 'unverified', publicList: d.publicList,
        statusNote: 'sent表示平台已接收或当前账号可读。未登录列表仅核对当次最多20条样本；未出现不等于未发送，出现不保证其他时刻、账号或通知。' } : {}) }; }).filter(d => d.text); }
  budget(account, roundKey = '', now = this.c.now(), config = this.store.config()) {
    const window = this.store.window(config, now);
    const row = this.db.prepare('SELECT COUNT(*) AS n FROM ' + attempts + ' WHERE account_uid=? AND at_ms>=? AND at_ms<?')
      .get(account, window.start, window.end);
    const round = this.db.prepare('SELECT COUNT(*) AS n FROM ' + attempts + ' WHERE account_uid=? AND round_key=?').get(account, roundKey).n;
    const latest = this.db.prepare('SELECT MAX(at_ms) AS t FROM ' + attempts + ' WHERE account_uid=?').get(account).t;
    const mentions = this.db.prepare('SELECT COUNT(*) AS n FROM mention_attempts WHERE account_uid=? AND at_ms>=? AND at_ms<?').get(account, window.start, window.end).n;
    return { attempts: Number(row.n), roundAttempts: Number(round), mentionAttempts: Number(mentions), latest,
      limit: config.dailyCommentLimit, roundLimit: config.perRoundCommentLimit, mentionLimit: config.dailyMentionLimit, end: window.end };
  }
  selected(uids, config) {
    assert(Array.isArray(uids) && uids.length <= config.mentionsPerComment && new Set(uids).size === uids.length,
      'COMMENT_MENTION', '提及人数超过上限或包含重复对象。');
    assert(!uids.length || config.commentMentionsEnabled, 'MENTIONS_DISABLED', '评论@已关闭，请明确更新预览后再发布。');
    const targets = uids.map(uid => {
      uidOf(uid);
      const t = config.mentionTargets.find(t => t.uid === uid && t.enabled && t.allowComment);
      assert(t, 'MENTION_TARGET', '提及对象已删除、停用或不允许用于评论。');
      return { uid: t.uid, name: t.name };
    });
    assert(new Set(targets.map(t => t.name)).size === targets.length, 'MENTION_NAME', '同名提及对象无法区分，请只选择其中一个。');
    return targets;
  }
  stage(id, uids, internal = false) {
    if (!internal) { this.c.assertNotInstalling(); assert(!this.store.active() && !this.c.scheduler.busy && !this.c.scheduler.starting, 'RUN_BUSY', '请等当前任务结束。', 409); }
    const run = this.store.run(requestIdOf(id));
    assert(['video', 'interaction'].includes(run?.kind) && run.state === 'preview' && run.preview?.should_comment, 'COMMENT_DRAFT', '没有已完成且愿意评论的有效草稿。');
    assert(!this.get(id) || ['draft', 'cancelled'].includes(this.get(id).state), 'COMMENT_HANDLED', '这条草稿已有发送尝试，不能覆盖或重发。', 409);
    const source = run.configSnapshot || this.store.config();
    parsePreview(JSON.stringify(run.preview), run, run.evidence, source);
    uidOf(run.accountUid);
    const config = this.store.config(), mentions = this.selected(uids ?? run.preview.mention_uids ?? [], config);
    assert(!run.interactionTarget || !mentions.length, 'INTERACTION_MENTION', '评论互动绑定原留言，不附加额外提及对象。');
    const text = run.preview.comment + (mentions.length ? '\n' + mentions.map(t => '@' + t.name + ' ').join('') : '');
    this.c.privacy.check(text, { mentions });
    assert(text.length <= config.commentMaxChars, 'COMMENT_LENGTH', '加上提及后的最终评论超过字数上限，请减少对象或重新生成。');
    const d = { id, kind: run.kind, accountUid: run.accountUid, bvid: bvidOf(run.bvid), roundKey: run.interactionRoundKey || run.roundId || 'manual:' + id,
      ...(run.interactionTarget ? { target: run.interactionTarget } : {}),
      text, mentions, policy: policy(source), state: 'draft', createdAt: Date.parse(run.createdAt),
      autoEligible: internal && source.commentMode === 'auto', reason: '最终评论预览已准备，尚未发送。' };
    d.revision = revisionOf(d);
    this.store.set('commentAccount', d.accountUid); this.save(d); this.kick();
    return { publication: exposed(d), message: '最终预览已更新，尚未发送。' };
  }
  assertDraft(d, auto = false, quota = true) {
    const config = this.store.config(), run = d && this.store.run(d.id);
    assert(d?.state === 'draft' && ['video', 'interaction'].includes(run?.kind) && run.state === 'preview', 'COMMENT_DRAFT', '草稿不在可发送状态。', 409);
    assert(typeof d.text === 'string' && d.text.replace(/[\s\p{Cf}\p{Cc}]/gu, '').length > 0,
      'COMMENT_EMPTY', '评论正文为空或只有不可见字符，未提交发送；请重新生成草稿。');
    this.c.learning.checkOutput(d.text, d.accountUid);
    this.c.privacy.check(d.text, { mentions: d.mentions });
    if (run.interactionTarget) {
      assert(JSON.stringify(d.target) === JSON.stringify(run.interactionTarget), 'COMMENT_TARGET', '互动对象与原留言不匹配。');
      this.c.interactions.assertAllowed(d);
    }
    assert(policy(config) === d.policy, 'COMMENT_STALE', '基础人设、知识包或使用者身份已变化，请重新读取并生成评价。');
    const mentions = this.selected(d.mentions.map(t => t.uid), config);
    assert(JSON.stringify(mentions) === JSON.stringify(d.mentions), 'MENTION_CHANGED', '提及昵称或对象已变化，请重新更新预览。');
    assert(d.text.length <= config.commentMaxChars && revisionOf(d) === d.revision,
      'COMMENT_STALE', '最终文案或版本不匹配，请更新预览。');
    if (!quota) return;
    this.c.privacy.gate('comment:' + d.id, d.revision, auto, this.requiresPrivacyReview());
    assert(!this.paused && config.commentMode !== 'preview', 'COMMENTS_DISABLED', '评论发送已暂停或仍为预览模式。', 409);
    if (auto) assert(config.commentMode === 'auto' && d.autoEligible && d.createdAt >= this.store.get('commentAutoSince', Infinity) &&
      !this.c.scheduler.paused && inActivity(this.c.now(), config), 'COMMENT_AUTO', '当前草稿不符合自动发送条件。', 409);
    assert(d.target ? !this.db.prepare('SELECT 1 FROM reply_attempts WHERE account_uid=? AND bvid=? AND target_id=?').get(d.accountUid, d.bvid, d.target.id) :
      !this.db.prepare('SELECT 1 FROM comment_attempts WHERE account_uid=? AND bvid=?').get(d.accountUid, d.bvid),
      'COMMENT_DUPLICATE', '当前账号已尝试评论这个视频，不重复发送。', 409);
    if(d.target)assert(!this.db.prepare('SELECT 1 FROM account_reply_attempts p JOIN account_comments a ON a.id=p.id WHERE p.account_uid=? AND a.resource_key=? AND a.target_id=?').get(d.accountUid,'video:'+d.bvid,d.target.id),'COMMENT_DUPLICATE','账号管理已尝试回复这条评论，不重复发送。',409);
    const b = this.budget(d.accountUid, d.roundKey);
    assert(b.attempts < b.limit, 'COMMENT_LIMIT', '已达到每日评论上限（0关闭发送）。', 409);
    assert(d.target || b.roundAttempts < b.roundLimit, 'COMMENT_ROUND_LIMIT', '已达到本轮主动评论上限（0关闭发送）。', 409);
    assert(!b.latest || this.c.now() - b.latest >= config.commentMinIntervalSeconds * 1000, 'COMMENT_COOLDOWN', '尚未达到评论最短间隔。', 409);
    const window = this.store.window(config, this.c.now());
    assert(!this.db.prepare('SELECT 1 FROM ' + attempts + ' WHERE account_uid=? AND text_hash=? AND at_ms>=? AND at_ms<?')
      .get(d.accountUid, hash(d.text), window.start, window.end), 'COMMENT_REPEAT', '当天已经尝试过相同文案，请避免重复评论。', 409);
    assert(b.mentionAttempts + d.mentions.length <= b.mentionLimit, 'MENTION_LIMIT', '每日提及次数不足，未修改已预览文案。', 409);
    for (const t of d.mentions) {
      const latest = this.db.prepare('SELECT MAX(at_ms) AS t FROM mention_attempts WHERE account_uid=? AND uid=?').get(d.accountUid, t.uid).t;
      assert(!latest || this.c.now() - latest >= config.mentionMinIntervalSeconds * 1000, 'MENTION_COOLDOWN', '某个账号尚未达到最短提及间隔。', 409);
    }
  }
  reserve(d, auto) {
    return this.store.transaction(() => {
      d = this.get(d.id); this.assertDraft(d, auto);
      const now = this.c.now(); this.store.window(this.store.config(), now, true);
      if (d.target) this.db.prepare('INSERT INTO reply_attempts VALUES(?,?,?,?,?,?,?,?,?)').run(d.id, d.accountUid, d.bvid, d.target.id, this.store.run(d.id).sourceRunId, d.target.level, d.roundKey, hash(d.text), now);
      else this.db.prepare('INSERT INTO comment_attempts VALUES(?,?,?,?,?,?)').run(d.id, d.accountUid, d.bvid, d.roundKey, hash(d.text), now);
      for (const t of d.mentions) this.db.prepare('INSERT INTO mention_attempts VALUES(?,?,?,?,?)').run(d.id, d.accountUid, t.uid, 'comment', now);
      return this.save({ ...d, state: 'sending', attemptedAt: now, reason: '已占用发送及提及次数，等待平台回执。' }, false);
    });
  }
  background(operation, sourceId) {
    this.c.assertNotInstalling();
    assert(!this.store.active() && !this.c.scheduler.busy && !this.c.scheduler.starting, 'RUN_BUSY', '请等当前视频或私信任务结束。', 409);
    this.busy = true; this.c.metadataBusy = true; this.c.metadataBusyMessage = '正在处理评论发布或核对，请稍候。'; this.error = null; this.recoveryBvid = '';
    this.job = Promise.resolve().then(() => { if (!this.c.closed) return operation(); }).catch(error => {
      if (!this.c.closed) {
        this.error = errorView(error); this.notice = this.error.message;
        this.recoveryBvid = error.code === 'COMMENT_STALE' ? this.get(sourceId)?.bvid || '' : '';
      }
    }).finally(() => { this.busy = false; this.c.metadataBusy = false; this.c.metadataBusyMessage = ''; });
    return { message: '评论操作已提交，状态会自动更新。' };
  }
  async preflight(d) {
    const found = await this.c.reader().call(d.target ? 'comment_reply_probe' : 'comment_probe', { bvid: d.bvid, expected_account: d.accountUid, mentions: d.mentions, ...this.replyParams(d) });
    assert(found?.accountUid === d.accountUid && found.bvid === d.bvid && typeof found.oid === 'string' && /^[1-9]\d*$/.test(found.oid) &&
      JSON.stringify(found.mentions) === JSON.stringify(d.mentions) && (!d.target || JSON.stringify(found.target) === JSON.stringify(d.target)), 'COMMENT_TARGET', '登录账号、视频或互动/提及对象与最终预览不匹配。');
    return found;
  }
  replyParams(d) { return d.target ? { target: d.target,
    ...(this.store.run(d.id)?.interactionTrigger === 'self_reply' ? { self_reply_parent: this.store.run(d.id).selfReplyReceipt } : {}),
    ...(this.store.run(d.id)?.interactionTrigger === 'owner_mention' ? { owner_mention_uid: ownerUid(this.store.config()) } : {}) } : {}; }
  async send(id, revision, auto = false) {
    let d = this.get(requestIdOf(id)); this.assertDraft(d, auto);
    assert(revision === d.revision, 'COMMENT_REVISION', '预览已经更新，请查看当前文案后再发送。');
    const binding = await this.c.host.requireBinding();
    assert(binding.sessionId === this.store.run(d.id).sessionId, 'BINDING_MISMATCH', '评论草稿与当前原对话不一致。');
    const target = await this.preflight(d);
    if (this.c.closed) return;
    await this.c.host.requireBinding();
    if (this.c.closed) return;
    d = this.get(id); this.assertDraft(d, auto);
    assert(revision === d.revision, 'COMMENT_REVISION', '预览已经更新，请查看当前文案后再发送。');
    d = this.reserve(d, auto);
    try {
      const result = await this.c.reader().call(d.target ? 'comment_reply_publish' : 'comment_publish', { bvid: d.bvid, expected_account: d.accountUid, oid: target.oid, text: d.text, mentions: d.mentions, ...this.replyParams(d) });
      if (this.c.closed) return;
      const sameTarget = result?.accountUid === d.accountUid && result.bvid === d.bvid &&
        (!d.target || JSON.stringify(result.target) === JSON.stringify(d.target));
      const feedback = sameTarget ? feedbackOf(result.platformFeedback) : undefined;
      const confirmed = sameTarget && result.confirmed === true && feedback?.needCaptcha !== true && /^[1-9]\d*$/.test(result.receipt || '');
      const candidate = !confirmed && sameTarget && /^[1-9]\d*$/.test(result.receiptCandidate || result.receipt || '') ? result.receiptCandidate || result.receipt : undefined;
      d = this.save({ ...d, state: confirmed ? 'sent' : 'unknown', receipt: confirmed ? result.receipt : '',
        platformFeedback: feedback, receiptCandidate: candidate,
        ...(confirmed ? { confirmationSource: 'platform_receipt', confirmedAt: this.c.now() } : {}),
        mentionState: d.mentions.length ? result?.mentionState === 'rendered' ? 'rendered' : 'unverified' : 'none',
        reason: feedback?.needCaptcha === true ? '平台返回验证码要求，发送结果待核对；不会自动处理验证码或重新发送。' :
          confirmed ? '平台已返回评论编号；公开列表可见性未确认，收到回执不等于其他账号能看到或收到提及通知。' : '发送结果未确认；不重发，可只读核对最近评论。' });
    } catch (error) {
      if (this.c.closed) return;
      d = this.save({ ...d, state: ['COMMENT_REJECTED', 'COMMENT_PREFLIGHT'].includes(error.code) ? 'failed' : 'unknown',
        reason: ['COMMENT_REJECTED', 'COMMENT_PREFLIGHT'].includes(error.code) ? error.message + ' 本次尝试仍计数，不重发。' : '发送结果未确认；本次尝试仍计数，不重发。' });
    }
    this.notice = d.reason;
  }
  publish(id, revision, input = {}) {
    return this.background(() => {
      this.c.privacy.review('comment:' + id, revision, input, this.requiresPrivacyReview());
      return this.send(id, revision);
    }, id);
  }
  check(id) { return this.background(async () => {
    const d = this.get(requestIdOf(id)); this.assertDraft(d, false, false); await this.preflight(d);
    if (!this.c.closed) this.notice = '登录账号、视频与提及对象读取检查通过，未发送。实际评论和提及效果仍须在B站确认。';
  }, id); }
  verify(id) { return this.background(async () => {
    const d = this.get(requestIdOf(id));
    assert(d && !d.contentCleared && ['unknown', 'sent'].includes(d.state), 'COMMENT_VERIFY', '没有可核对的本地文案；删除记录后可到B站核对，仍不重发。');
    const found = await this.c.reader().call(d.target ? 'comment_reply_verify' : 'comment_verify', { bvid: d.bvid, expected_account: d.accountUid, text: d.text,
      attempted_at: d.attemptedAt, receipt: d.receipt || d.receiptCandidate || '', mentions: d.mentions, ...(d.target ? { target: d.target } : {}) });
    if (this.c.closed) return;
    assert(found?.accountUid === d.accountUid && found.bvid === d.bvid && (!d.target || JSON.stringify(found.target) === JSON.stringify(d.target)), 'COMMENT_VERIFY', '核对账号、视频或互动目标不匹配。');
    if (found.confirmed && /^[1-9]\d*$/.test(found.receipt || '')) {
      assert(!(d.receipt || d.receiptCandidate) || found.receipt === (d.receipt || d.receiptCandidate), 'COMMENT_VERIFY', '核对返回了不同评论编号；保留原记录，不重发。');
      const view = found.publicList;
      const publicList = !d.target && ['found', 'not_in_sample'].includes(view?.state) && Number.isInteger(view.sampleCount) && view.sampleCount >= (view.state === 'found' ? 1 : 0) && view.sampleCount <= 20 ?
        { state: view.state, sampleCount: view.sampleCount, checkedAt: this.c.now() } :
        !d.target && view?.state === 'unavailable' ? { state: 'unavailable', checkedAt: this.c.now() } : { state: 'unchecked' };
      const visibility = ({ found: '本次未登录最新评论样本中找到匹配记录；仅确认当次样本，不能保证其他账号或通知。',
        not_in_sample: '未登录最新评论样本中未找到，公开列表可见性未确认；未出现不能证明没有发送。',
        unavailable: '未登录列表检查暂不可用，公开可见性未确认。' })[publicList.state] || '公开列表可见性未确认。';
      this.save({ ...d, state: 'sent', receipt: found.receipt, confirmationSource: 'account_lookup', confirmedAt: this.c.now(),
        publicList, mentionState: d.mentions.length ? found.mentionState || 'unverified' : 'none',
        reason: '当前登录账号的接口查到匹配记录；' + visibility + ' 没有重新发送。' });
      this.notice = '当前账号查到匹配记录；' + visibility + ' 没有重新发送。';
    } else this.notice = '最近20条评论中未找到唯一匹配项；这不能证明没有发送，仍不重发。';
  }); }
  configured(before, after) {
    if (before.commentMode !== 'auto' && after.commentMode === 'auto') this.store.set('commentAutoSince', this.c.now());
    if (before.commentPrivacyMode !== after.commentPrivacyMode) {
      this.store.set('commentRetryAfter', 0); this.error = null;
      this.notice = after.commentPrivacyMode === 'content' ? '已改为按本条评论内容检查；自动模式将继续处理符合条件的待发草稿。' : '已启用逐条隐私审核；同一对话含私信历史时，需要人工核对公开评论。';
      for (const row of this.db.prepare("SELECT data FROM comment_drafts WHERE state='draft' AND json_extract(data,'$.reason') LIKE '同一对话含私密历史，已阻止%'").all()) {
        const d = JSON.parse(row.data); this.save({ ...d, reason: this.notice }, false);
      }
    }
    this.kick();
  }
  pause() { this.store.set('commentsPaused', true); return { message: '评论发送已暂停，已发出的请求无法撤回。' }; }
  resume() { this.store.set('commentsPaused', false); this.kick(); return { message: '评论发送已继续，仍受模式、额度与冷却限制。' }; }
  drop(id) {
    const d = this.get(id);
    if (d) this.save({ ...d, state: d.state === 'draft' ? 'cancelled' : d.state, autoEligible: false, text: '', mentions: [], platformFeedback: undefined, contentCleared: true,
      ...(d.target ? { target: { ...d.target, text: '' } } : {}),
      reason: '浏览记录及本地文案已删除；已发评论不会撤回，计数与防重标识保留。结果不明时请到B站核对，不重发。' }, false);
  }
  start() { this.timer = setInterval(() => this.tick(), 15000); this.timer.unref?.(); }
  kick() { const timer = setTimeout(() => this.tick(), 0); timer.unref?.(); }
  tick() {
    const c = this.c;
    if (c.closed || this.busy || this.paused || c.scheduler.paused || c.now() < this.store.get('commentRetryAfter', 0) || c.store.config().commentMode !== 'auto' ||
      !inActivity(c.now(), c.store.config()) || c.store.active() || c.scheduler.busy || c.scheduler.starting || c.social.busy || c.weekly?.busy || c.installing || c.metadataBusy) return;
    const account = c.social.account || this.store.get('commentAccount', ''), session = this.store.get('binding')?.sessionId;
    if (!account || !session) return;
    const candidates = this.db.prepare("SELECT d.data FROM comment_drafts d JOIN runs r ON r.id=d.id WHERE d.account_uid=? AND json_extract(r.data,'$.sessionId')=? AND d.state='draft' AND json_extract(d.data,'$.autoEligible')=1 ORDER BY d.rowid LIMIT 50")
      .all(account, session).map(row => JSON.parse(row.data));
    if (!candidates.length) return;
    this.background(async () => {
      for (const d of candidates) {
        if (c.closed || this.paused || c.store.config().commentMode !== 'auto') return;
        try { await this.send(d.id, d.revision, true); return; }
        catch (error) {
          if (c.closed) return;
          const held = ['COMMENT_EMPTY', 'COMMENT_STALE', 'MENTION_CHANGED', 'MENTIONS_DISABLED', 'MENTION_TARGET', 'COMMENT_DUPLICATE', 'COMMENT_ROUND_LIMIT', 'INTERACTION_DISABLED', 'INTERACTION_LIMIT'].includes(error.code);
          this.save({ ...this.get(d.id), ...(held ? { autoEligible: false } : {}), reason: errorView(error).message });
          this.notice = errorView(error).message;
          if (['COMMENT_LIMIT', 'COMMENT_COOLDOWN'].includes(error.code)) return;
          if (!['COMMENT_EMPTY', 'COMMENT_AUTO', 'COMMENT_STALE', 'MENTION_CHANGED', 'MENTIONS_DISABLED', 'MENTION_TARGET', 'MENTION_LIMIT', 'MENTION_COOLDOWN', 'COMMENT_DUPLICATE', 'COMMENT_REPEAT', 'COMMENT_ROUND_LIMIT', 'INTERACTION_DISABLED', 'INTERACTION_LIMIT'].includes(error.code)) {
            this.store.set('commentRetryAfter', c.now() + 60000); return;
          }
        }
      }
    });
  }
  close() { clearInterval(this.timer); }
}
