import { createHash } from 'node:crypto';
import { assert, errorView } from './errors.mjs';

const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const rules = [
  ['less_formulaic', /ai味太重|太像ai|像机器人|机器人味|模板味|太模板化|像客服/giu, '考虑减少模板化开场和套话，让表达更自然；不要伪装成人类或编造经历。'],
  ['more_concise', /废话太多|太啰嗦|太罗嗦|说得太绕|太冗长|重复说|重复回答/gu, '考虑先说重点，减少重复和不必要的铺陈。'],
  ['clearer', /看不懂|没看懂|说清楚|不够清楚|解释不清/gu, '考虑用更具体、容易理解的表达，核对是否解释了关键依据。'],
  ['less_preachy', /太说教|别说教|不要说教|太官方|太生硬/gu, '考虑减少说教或过于官方的语气，保留基础人设要求的尊重与边界。'],
];

export class Feedback {
  constructor(c) {
    this.c = c; this.s = c.store; this.db = this.s.db;
    this.db.exec('CREATE TABLE IF NOT EXISTS learning_feedback(id TEXT PRIMARY KEY,account_uid TEXT NOT NULL,at_ms INTEGER NOT NULL,dedup_key TEXT NOT NULL UNIQUE,data TEXT NOT NULL);');
  }
  enabled() { const config = this.s.config(); return config.learningEnabled && config.learningFeedbackEnabled; }
  record({ account, sender, sourceId, text, scope, bvid = '', url = '' }) {
    if (!this.enabled()) return 0;
    assert(['public_reply', 'private_style'].includes(scope) && typeof text === 'string' && text.length <= 2000,
      'FEEDBACK_SOURCE', '交流反馈来源无效。');
    const window = this.s.window(this.s.config(), this.c.now());
    const count = Number(this.db.prepare('SELECT COUNT(*) n FROM learning_feedback WHERE account_uid=? AND at_ms>=? AND at_ms<?').get(account, window.start, window.end).n);
    if (count >= 50) return 0;
    let added = 0;
    for (const [code, re, suggestion] of rules) {
      if (count + added >= 50) break;
      re.lastIndex = 0; const match = re.exec(text.normalize('NFKC')); if (!match) continue;
      if (/(?:没有|并非|不是|不觉得|不认为)[^。！？]{0,8}$/.test(text.slice(0, match.index))) continue;
      const key = digest([account, sender, code, window.start]), id = 'feedback-' + digest([account, scope, sourceId, code]).slice(0, 40);
      if (this.db.prepare('SELECT 1 FROM learning_feedback WHERE id=? OR dedup_key=?').get(id, key)) continue;
      // Only a fixed style category crosses the private/public boundary. No raw DM text or identity.
      const value = { id, kind: 'feedback', scope, code, summary: suggestion, title: scope === 'public_reply' ? '他人对自己评论的公开回复' : '交流表达建议（已脱敏）',
        bvid: scope === 'public_reply' ? bvid : '', url: scope === 'public_reply' ? url : '', quote: scope === 'public_reply' ? match[0] : '',
        observedAt: new Date(this.c.now()).toISOString() };
      this.c.privacy.check(value.quote + '\n' + suggestion, { session: '' });
      this.s.transaction(() => {
        this.db.prepare('INSERT INTO learning_feedback VALUES(?,?,?,?,?)').run(id, account, this.c.now(), key, JSON.stringify(value));
        this.db.prepare('INSERT OR IGNORE INTO learning_observations VALUES(?,?,?,?,?)').run(id, account, this.c.now(), '', JSON.stringify(value));
        this.s.set('learningAccount', account);
      }); added++;
    }
    return added;
  }
  status() {
    const account = this.c.learning.account;
    return { enabled: this.enabled(), busy: !!this.busy, notice: this.notice || '',
      total: Number(this.db.prepare('SELECT COUNT(*) n FROM learning_feedback WHERE account_uid=?').get(account).n),
      recent: this.db.prepare('SELECT f.data,r.review_id FROM learning_feedback f LEFT JOIN learning_review_sources r ON r.source_id=f.id WHERE account_uid=? ORDER BY at_ms DESC,id DESC LIMIT 10').all(account)
        .map(r => ({ ...JSON.parse(r.data), includedInReview: !!r.review_id })) };
  }
  scan() {
    this.c.social.assertIdle();
    assert(this.enabled(), 'FEEDBACK_DISABLED', '请先开启自主学习及交流反馈。');
    assert(!this.s.openRound(), 'RUN_BUSY', '请等待当前浏览轮次结束。');
    this.busy = true; this.c.metadataBusy = true; this.c.metadataBusyMessage = '正在检查他人对自己评论的回复。';
    this.notice = '正在只读检查一条自己评论的回复…';
    this.job = this.inspect().catch(e => { if (!this.c.closed) this.notice = errorView(e).message; }).finally(() => {
      this.busy = false; this.c.metadataBusy = false; this.c.metadataBusyMessage = '';
    });
    return { message: '交流反馈检查已提交，不调用模型或发送评论。' };
  }
  async inspect() {
    await this.c.host.requireBinding(); if (this.c.closed) return;
    const identity = await this.c.reader().call('account'); if (this.c.closed) return;
    assert(identity.status === 'logged_in' && /^[1-9]\d{0,19}$/.test(String(identity.uid)), 'NOT_LOGGED_IN', '请先检查登录。');
    const account = String(identity.uid);
    const rows = this.db.prepare("SELECT data FROM comment_drafts WHERE account_uid=? AND state='sent' ORDER BY rowid DESC LIMIT 20").all(account)
      .map(r => JSON.parse(r.data)).filter(d => /^[1-9]\d{0,29}$/.test(d.receipt || '') && d.text);
    const times = this.s.get('feedbackChecked', {}), d = rows.sort((a, b) => (times[a.id] || 0) - (times[b.id] || 0))[0];
    if (!d) { this.notice = '还没有可核对的已确认自己评论；有回复后再学习。'; return; }
    const result = await this.c.reader().call('comment_feedback', { expected_account: account, bvid: d.bvid, comment_id: d.receipt,
      root_id: d.target?.root || d.receipt, text: d.text, mentions: d.mentions, attempted_at: d.attemptedAt }, 65000);
    if (this.c.closed) return;
    assert(result?.accountUid === account && result.bvid === d.bvid && result.commentId === d.receipt && Array.isArray(result.replies) && result.replies.length <= 20,
      'FEEDBACK_SOURCE', '回复记录不属于这条已核实的自己评论。');
    let added = 0;
    for (const r of result.replies) {
      assert(/^[1-9]\d{0,29}$/.test(r.id) && /^[1-9]\d{0,19}$/.test(r.uid) && r.uid !== account && r.parent === d.receipt &&
        typeof r.text === 'string' && r.text.length <= 500, 'FEEDBACK_SOURCE', '返回的直接回复标识或文本无效。');
      added += this.record({ account, sender: r.uid, sourceId: r.id, text: r.text, scope: 'public_reply', bvid: d.bvid,
        url: 'https://www.bilibili.com/video/' + d.bvid + '/#reply' + r.id });
    }
    this.s.set('feedbackChecked', Object.fromEntries(rows.map(row => [row.id, row.id === d.id ? this.c.now() : times[row.id] || 0])));
    this.notice = '已核对最多20条直接回复，新增' + added + '条表达反馈候选；日终比较后自主决定是否采用。';
  }
  start() { this.timer = setInterval(() => this.tick(), 60000); this.timer.unref?.(); }
  tick() {
    if (!this.enabled() || this.c.closed || this.busy || this.c.now() < this.s.get('feedbackNextPoll', 0)) return;
    if (this.c.store.active() || this.s.openRound() || this.c.scheduler.busy || this.c.scheduler.starting || this.c.social.busy || this.c.weekly.busy || this.c.installing || this.c.metadataBusy) return;
    this.s.set('feedbackNextPoll', this.c.now() + 3600000);
    try { this.scan(); } catch (e) { this.notice = errorView(e).message; }
  }
  close() { clearInterval(this.timer); }
}
