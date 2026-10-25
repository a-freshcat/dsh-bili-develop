import { createHash, randomUUID } from 'node:crypto';
import { ownerUid, uidOf } from './owner.mjs';
import { assert, errorView } from './errors.mjs';
import { inActivity } from './time.mjs';
import { requestIdOf } from './decision.mjs';

export class OwnerMentions {
  constructor(c) { this.c = c; this.s = c.store; }
  enabled(config = this.s.config()) { return !!(config.ownerCommentReplyEnabled && ownerUid(config)); }
  configured(before, after) {
    if (this.enabled(after) && (!this.enabled(before) || ownerUid(before) !== ownerUid(after))) this.s.set('ownerMentionSince', this.c.now());
    this.s.set('ownerMentionNextPoll', this.c.now());
  }
  canRetry(run) {
    const account = this.c.social.account || this.s.get('commentAccount', '');
    return !!(run?.state === 'failed' && run.interactionTrigger === 'owner_mention' && run.accountUid === account &&
      run.interactionTarget?.uid === ownerUid(this.s.config()) && this.enabled() &&
      !this.s.db.prepare('SELECT 1 FROM reply_attempts WHERE account_uid=? AND bvid=? AND target_id=?').get(account, run.bvid, run.interactionTarget.id) &&
      !this.s.get('ownerMentionRetry:' + run.id));
  }
  latest() {
    const account = this.c.social.account || this.s.get('commentAccount', '');
    const row = this.s.db.prepare("SELECT data FROM runs WHERE account_uid=? AND json_extract(data,'$.interactionTrigger')='owner_mention' ORDER BY created_at DESC,id DESC LIMIT 1").get(account);
    if (!row) return null;
    const run = JSON.parse(row.data), d = run.commentPublication, config = this.s.config();
    let message = run.error?.code === 'MODEL_EVIDENCE' ? '引用未通过原文核验，草稿没有进入发送；可以重新读取视频与评论区后生成回复。' : run.error?.message || run.commentNotice || '';
    if (d) message = d.state === 'sent' ? '平台已返回回复编号；公开展示和通知是否到达仍由B站决定。' : d.state === 'unknown' ? '回复发送结果未知，不重发；可到记录只读核对。' :
      d.state === 'sending' ? '正在发送回复，等待平台结果。' : d.state === 'failed' ? d.reason : d.state === 'draft' ?
        this.c.comments.paused ? '回复草稿已生成，评论已暂停。' : config.commentMode === 'preview' ? '回复草稿已生成，当前为仅预览，不会发送。' :
          config.commentMode === 'manual' ? '回复草稿已生成，等待逐条确认发送。' : this.c.comments.requiresPrivacyReview() ? '回复草稿已生成，等待逐条隐私审核。' :
            d.reason !== '最终评论预览已准备，尚未发送。' ? d.reason : '回复草稿已生成，等待自动发送检查、额度与冷却。' : d.reason;
    else if (run.preview?.should_comment === false) message = '已读并判断本次不回复：' + run.preview.reason;
    else if (run.state === 'reading') message = '正在读取@所在视频及关联评论区。';
    else if (run.state === 'awaiting_model') message = '视频与讨论资料已准备，正在原对话生成回应。';
    return { id: run.id, bvid: run.bvid, state: d?.state || run.state, message, canRetry: this.canRetry(run), videoRead: run.kind === 'video' && run.source === 'owner_mention' };
  }
  status() { return { enabled: this.enabled(), busy: !!this.busy, notice: this.notice || '', error: this.error || null,
    nextPoll: this.s.get('ownerMentionNextPoll', null), latest: this.latest() }; }
  retry(id) {
    const c = this.c, original = this.s.run(requestIdOf(id));
    assert(this.canRetry(original), 'OWNER_MENTION_RETRY', '这条@回复不能重新生成：只支持尚未尝试发送的失败记录；已发送或结果未知不重发。');
    c.social.assertIdle();
    assert(!c.store.openRound() && !c.scheduler.paused && !c.comments.paused, 'RUN_BUSY', '请等待浏览结束并继续浏览和评论。');
    assert(c.interactions.budget(original.accountUid).evaluations < this.s.config().dailyInteractionEvaluationLimit, 'INTERACTION_LIMIT', '今日互动判断次数已用完，未重新生成。');
    const retryId = 'mention-retry-' + randomUUID();
    this.busy = true; c.metadataBusy = true; c.metadataBusyMessage = '正在重新读取@视频与关联讨论。'; this.error = null;
    this.job = Promise.resolve().then(async () => {
      if (c.closed) return;
      const binding = await c.host.requireBinding(); assert(!binding.running, 'SESSION_BUSY', '等待原汇总对话空闲后重试。');
      assert(this.canRetry(original), 'OWNER_MENTION_RETRY', '使用者身份、账号或原回复状态已变化。');
      const admitted = this.s.start({ id: retryId, kind: 'video', source: 'owner_mention', bvid: original.bvid,
        accountUid: original.accountUid, sessionId: binding.sessionId, now: c.now(), admit: () => {
          assert(c.interactions.budget(original.accountUid).evaluations < this.s.config().dailyInteractionEvaluationLimit, 'INTERACTION_LIMIT', '今日互动判断次数已用完。');
          this.s.window(this.s.config(), c.now(), true);
          this.s.db.prepare('INSERT INTO interaction_retry_calls VALUES(?,?,?,?)').run(retryId, original.accountUid, c.now(), original.id);
          this.s.set('ownerMentionRetry:' + original.id, retryId);
        } });
      const run = this.s.update(admitted.run.id, { interactionTarget: original.interactionTarget, interactionTrigger: 'owner_mention',
        interactionOrigin: 'notification', interactionEpoch: this.s.get('interactionEpoch', 'initial'), sourceRunId: original.sourceRunId,
        interactionRoundKey: original.interactionRoundKey || 'interaction:' + original.sourceRunId, retryOf: original.id });
      c.launch(retryId, () => c.execute(run)); await c.jobs.get(retryId);
    }).catch(error => { if (!c.closed) { this.error = errorView(error); this.notice = this.error.message; } }).finally(() => {
      this.busy = false; c.metadataBusy = false; c.metadataBusyMessage = ''; if (!c.closed) c.comments.kick();
    });
    return { message: '已提交重新读取与生成@回复；沿用当前评论发送模式，结果会自动更新。' };
  }
  scan() {
    const c = this.c;
    assert(this.enabled(), 'OWNER_MENTION_DISABLED', '请先设置使用者账号并开启评论区@回复。');
    c.social.assertIdle();
    assert(!c.scheduler.paused && !c.comments.paused, 'COMMENTS_DISABLED', '请先继续浏览和评论。');
    assert(!this.busy, 'RUN_BUSY', '正在检查使用者@通知。');
    this.busy = true; c.metadataBusy = true; c.metadataBusyMessage = '正在核对使用者@通知。'; this.error = null;
    this.job = Promise.resolve().then(() => this.process()).catch(error => {
      if (!c.closed) { this.error = errorView(error); this.notice = this.error.message; }
    }).finally(() => { this.busy = false; c.metadataBusy = false; c.metadataBusyMessage = ''; if (!c.closed) c.comments.kick(); });
    return { message: '使用者@通知检查已提交，进度会自动更新。' };
  }
  async process() {
    const c = this.c, config = this.s.config(), epoch = this.s.get('interactionEpoch', 'initial');
    this.s.set('ownerMentionNextPoll', c.now() + config.ownerMentionPollSeconds * 1000);
    if (c.closed || !this.enabled() || (!config.interactionTopLimit && !config.interactionSubLimit) || !config.dailyInteractionEvaluationLimit) return;
    const knownAccount = c.social.account || this.s.get('commentAccount', '');
    if (knownAccount && c.interactions.budget(knownAccount).evaluations >= config.dailyInteractionEvaluationLimit) {
      this.notice = '今日评论互动判断次数已用完，未继续读取@通知。'; return;
    }
    const binding = await c.host.requireBinding();
    assert(!binding.running, 'SESSION_BUSY', '等待原汇总对话空闲后再检查@通知。');
    const since = this.s.get('ownerMentionSince', c.now());
    const found = await c.reader().call('owner_mentions', { owner_uid: ownerUid(config), since,
      handled_ids: this.s.db.prepare('SELECT target_id FROM interaction_evaluations WHERE account_uid=? ORDER BY at_ms DESC LIMIT 100')
        .all(c.social.account || this.s.get('commentAccount', '')).map(r => r.target_id),
      expected_account: c.social.account || this.s.get('commentAccount', '') });
    if (c.closed || !this.enabled() || epoch !== this.s.get('interactionEpoch', 'initial') || c.scheduler.paused || c.comments.paused) return;
    uidOf(found?.accountUid);
    assert(Array.isArray(found.matches) && found.matches.length <= 20, 'INTERACTION_READ', '使用者@通知结果无效。');
    const expected = c.social.account || this.s.get('commentAccount', '');
    assert(!expected || expected === found.accountUid, 'ACCOUNT_CHANGED', '通知账号已变化，请重新检查登录。');
    const counts = { top: 0, sub: 0 };
    for (const item of found.matches) {
      if (c.closed || c.scheduler.paused || c.comments.paused || epoch !== this.s.get('interactionEpoch', 'initial')) break;
      assert(item && /^BV[0-9A-Za-z]{10}$/.test(item.bvid) && typeof item.notificationId === 'string' && /^[1-9]\d{0,29}$/.test(item.notificationId) &&
        Number.isSafeInteger(item.at) && item.at >= since && item.at <= c.now() + 60000 && item.uid === ownerUid(config) && item.uid !== found.accountUid &&
        ['top', 'sub'].includes(item.level) && Array.isArray(item.mentionedUids) && item.mentionedUids.includes(found.accountUid),
      'INTERACTION_READ', '使用者@通知身份、时间或提及对象无效。');
      if (counts[item.level] >= config[item.level === 'top' ? 'interactionTopLimit' : 'interactionSubLimit'] ||
        this.s.db.prepare('SELECT 1 FROM interaction_evaluations WHERE account_uid=? AND bvid=? AND target_id=?').get(found.accountUid, item.bvid, item.id)) continue;
      if (c.interactions.budget(found.accountUid).evaluations >= config.dailyInteractionEvaluationLimit) break;
      const id = 'mention-' + createHash('sha256').update(JSON.stringify([found.accountUid, item.notificationId])).digest('hex').slice(0, 40);
      await c.interactions.inspect({ id, accountUid: found.accountUid, bvid: item.bvid, evidence: { title: '使用者@回复' } },
        { accountUid: found.accountUid, bvid: item.bvid, matches: [item], topRead: item.level === 'top' ? 1 : 0, subRead: item.level === 'sub' ? 1 : 0 });
      counts[item.level]++;
      if (c.interactions.error) { this.error = c.interactions.error; this.notice = c.interactions.notice; return; }
    }
    this.notice = `已检查最近20条@通知，使用者普通留言判断${counts.top}条、楼中楼判断${counts.sub}条；未发送或发送状态请查看评论记录。`;
  }
  start() { this.timer = setInterval(() => this.tick(), 15000); this.timer.unref?.(); }
  tick() {
    const c = this.c, config = this.s.config();
    if (c.closed || !this.enabled(config) || this.busy || c.metadataBusy || c.store.active() || c.store.openRound() || c.scheduler.paused ||
      c.comments.paused || c.scheduler.busy || c.scheduler.starting || c.social.busy || c.weekly?.busy || c.installing ||
      !config.dailyInteractionEvaluationLimit || (!config.interactionTopLimit && !config.interactionSubLimit) ||
      !inActivity(c.now(), config) || c.now() < this.s.get('ownerMentionNextPoll', 0)) return;
    try { this.scan(); } catch (error) { this.notice = errorView(error).message; }
  }
  close() { clearInterval(this.timer); }
}
