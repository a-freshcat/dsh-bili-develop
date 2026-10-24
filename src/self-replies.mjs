import { createHash } from 'node:crypto';
import { assert, errorView } from './errors.mjs';
import { inActivity } from './time.mjs';

// Independently poll replies to platform-confirmed comments, never arbitrary subthreads.
export class SelfReplies {
  constructor(c) { this.c = c; this.s = c.store; }
  enabled() { return this.s.config().selfCommentReplyEnabled; }
  configured(before, after) {
    if (after.selfCommentReplyEnabled && !before.selfCommentReplyEnabled) {
      this.s.set('selfReplySince', this.c.now()); this.s.set('selfReplyNextPoll', this.c.now());
    }
  }
  status() { return { enabled: this.enabled(), busy: !!this.busy, notice: this.notice || '', nextPoll: this.s.get('selfReplyNextPoll', null) }; }
  scan() {
    const c = this.c, config = this.s.config();
    assert(this.enabled(), 'SELF_REPLY_DISABLED', '请先开启对自己评论的回复。');
    c.social.assertIdle();
    assert(!c.store.openRound() && !c.scheduler.paused && !c.comments.paused, 'RUN_BUSY', '请等待浏览结束并继续浏览和评论。');
    assert(config.interactionSubLimit && config.dailyInteractionEvaluationLimit, 'INTERACTION_LIMIT', '楼中楼或每日互动判断上限为0，当前不检查。');
    this.busy = true; c.metadataBusy = true; c.metadataBusyMessage = '正在检查别人对自己评论的直接回复。';
    this.job = this.process().catch(e => { if (!c.closed) this.notice = errorView(e).message; }).finally(() => {
      this.busy = false; c.metadataBusy = false; c.metadataBusyMessage = ''; if (!c.closed) c.comments.kick();
    });
    return { message: '自己评论的回复检查已提交，结果会显示在互动记录。' };
  }
  async process() {
    const c = this.c, config = this.s.config(), epoch = this.s.get('interactionEpoch', 'initial');
    this.s.set('selfReplyNextPoll', c.now() + config.selfReplyPollSeconds * 1000);
    const known = c.social.account || this.s.get('commentAccount', '');
    if (known && c.interactions.budget(known).evaluations >= config.dailyInteractionEvaluationLimit) {
      this.notice = '今日互动判断次数已用完。'; return;
    }
    const binding = await c.host.requireBinding(); assert(!binding.running, 'SESSION_BUSY', '等待原汇总对话空闲后再检查回复。');
    if (c.closed) return;
    const identity = await c.reader().call('account'); if (c.closed) return;
    const account = String(identity?.uid || '');
    assert(identity?.status === 'logged_in' && /^[1-9]\d{0,19}$/.test(account) && (!known || known === account), 'ACCOUNT_CHANGED', '登录账号已变化或未登录，请重新检查。');
    const rows = this.s.db.prepare("SELECT data FROM comment_drafts WHERE account_uid=? AND state='sent' ORDER BY rowid DESC LIMIT 20").all(account)
      .map(r => JSON.parse(r.data)).filter(d => /^[1-9]\d{0,29}$/.test(d.receipt || '') && d.text && !d.contentCleared);
    const times = this.s.get('selfReplyChecked', {}), d = rows.sort((a, b) => (times[a.id] || 0) - (times[b.id] || 0))[0];
    if (!d) { this.notice = '没有可核对的已确认自己评论；未知或失败记录不能作为回复来源。'; return; }
    // Rotate unreadable/deleted threads as well; one failed source must not starve the rest.
    this.s.set('selfReplyChecked', Object.fromEntries(rows.map(r => [r.id, r.id === d.id ? c.now() : times[r.id] || 0])));
    const root = d.target?.root || d.receipt;
    const found = await c.reader().call('comment_feedback', { expected_account: account, bvid: d.bvid, comment_id: d.receipt,
      root_id: root, text: d.text, mentions: d.mentions, attempted_at: d.attemptedAt }, 65000);
    if (c.closed || !this.enabled() || epoch !== this.s.get('interactionEpoch', 'initial') || c.scheduler.paused || c.comments.paused) return;
    const currentAccount = c.social.account || this.s.get('commentAccount', '');
    assert(!currentAccount || currentAccount === account, 'ACCOUNT_CHANGED', '检查期间账号已变化，未处理回复。');
    assert(found?.accountUid === account && found.bvid === d.bvid && found.commentId === d.receipt && Array.isArray(found.replies) && found.replies.length <= 20,
      'INTERACTION_READ', '直接回复不属于已核实的自己评论。');
    const since = this.s.get('selfReplySince', c.now());
    const matches = found.replies.filter(r => r?.parent === d.receipt && r.root === root && r.level === 'sub' && r.uid !== account &&
      Number.isSafeInteger(r.at) && r.at > since && r.at <= c.now() + 60000 &&
      !this.s.db.prepare('SELECT 1 FROM interaction_evaluations WHERE account_uid=? AND bvid=? AND target_id=?').get(account, d.bvid, String(r.id)));
    if (!matches.length) { this.notice = '已检查一条自己评论的最多20条回复，没有未处理的开启后直接来信。'; return; }
    const id = 'self-replies-' + createHash('sha256').update(JSON.stringify([account, d.id, matches.map(r => r.id), epoch])).digest('hex').slice(0, 40);
    await c.interactions.inspect({ id, bvid: d.bvid, accountUid: account, selfReplyDraftId: d.id, selfReplyReceipt: d.receipt, evidence: { title: '对自己评论的回复' } },
      { accountUid: account, bvid: d.bvid, matches, topRead: 0, subRead: found.replies.length });
    this.notice = c.interactions.notice;
  }
  start() { this.timer = setInterval(() => this.tick(), 15000); this.timer.unref?.(); }
  tick() {
    const c = this.c, config = this.s.config();
    if (c.closed || !this.enabled() || this.busy || c.metadataBusy || c.store.active() || c.store.openRound() || c.scheduler.paused || c.comments.paused ||
      c.scheduler.busy || c.scheduler.starting || c.social.busy || c.weekly.busy || c.installing || !config.interactionSubLimit || !config.dailyInteractionEvaluationLimit ||
      !inActivity(c.now(), config) || c.now() < this.s.get('selfReplyNextPoll', 0)) return;
    try { this.scan(); } catch (e) { this.notice = errorView(e).message; }
  }
  close() { clearInterval(this.timer); }
}
