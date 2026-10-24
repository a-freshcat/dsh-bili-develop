import { createHash } from 'node:crypto';
import { Contacts, eligibility, rankedContacts, parsePrivate } from './contacts.mjs';
import { ownerUid, uidOf } from './owner.mjs';
import { assert, errorView } from './errors.mjs';
import { inActivity } from './time.mjs';

const keyOf = (account, m) => 'dm-' + createHash('sha256').update(JSON.stringify([account, m.uid, m.id])).digest('hex').slice(0, 40);
const draftPolicy = config => JSON.stringify([config.persona, ownerUid(config), config.ownerAccountName, config.ownerAttitudeEnabled]);
export class Social {
  constructor(controller) {
    this.c = controller; this.store = controller.store; this.contacts = new Contacts(this.store);
    for (const row of this.store.db.prepare("SELECT data FROM private_messages WHERE state='sending'").all()) {
      this.contacts.saveMessage({ ...JSON.parse(row.data), state: 'unknown', reason: '重启前发送结果未确认；不会重发，请到B站核对。' });
    }
  }
  get account() { return this.store.get('socialAccount', ''); }
  get paused() { return this.store.get('dmPaused', false); }
  setAccount(account) {
    uidOf(account); this.store.set('socialAccount', account);
    const uid = ownerUid(this.store.config());
    if (uid) this.contacts.put(account, uid, { name: this.store.config().ownerAccountName });
  }
  configured(before, after) {
    if (after.dmEnabled && !before.dmEnabled) this.store.set('dmSince', this.c.now());
    if (this.account && ownerUid(after)) this.contacts.put(this.account, ownerUid(after), { name: after.ownerAccountName });
    this.store.set('dmNextPoll', this.c.now() + after.dmPollSeconds * 1000);
  }
  status({ contactsOffset = 0, contactQuery = '', privateView = {} } = {}) {
    assert(Number.isInteger(contactsOffset) && contactsOffset >= 0 && contactsOffset <= 1000000 &&
      typeof contactQuery === 'string' && contactQuery.length <= 100, 'CONTACT_PAGE', '联系人查询无效。');
    const config = this.store.config(), people = this.contacts.all(this.account), uid = ownerUid(config);
    const ranking = rankedContacts(people, config);
    const ranks = new Map(ranking.map((p, i) => [p.uid, i]));
    const annotate = p => ({ ...p, eligibility: eligibility(p, people, config, ranks) });
    const others = people.filter(p => p.uid !== uid).sort((a, b) => b.score - a.score || (BigInt(a.uid) < BigInt(b.uid) ? -1 : 1))
      .filter(p => !contactQuery || p.uid.includes(contactQuery) || p.name.includes(contactQuery));
    assert(privateView && typeof privateView === 'object' && !Array.isArray(privateView) &&
      Object.keys(privateView).every(k => ['uid', 'offset', 'peopleOffset', 'q', 'account'].includes(k)), 'DM_PAGE', '私信会话查询格式无效。');
    let view = { uid: '', offset: 0, peopleOffset: 0, q: '', account: '', ...privateView };
    assert(typeof view.uid === 'string' && typeof view.account === 'string' && typeof view.q === 'string' && view.q.length <= 100 && !/[\r\n\0]/.test(view.q) &&
      [view.offset, view.peopleOffset].every(n => Number.isInteger(n) && n >= 0 && n <= 1000000), 'DM_PAGE', '私信会话分页或搜索格式无效。');
    uidOf(view.uid, true); uidOf(view.account, true);
    if (view.account && view.account !== this.account) view = { uid: '', offset: 0, peopleOffset: 0, q: '', account: this.account };
    view.account = this.account; view.q = view.q.trim();
    const byUid = new Map(people.map(p => [p.uid, p]));
    const threads = this.contacts.threads(this.account).map(row => ({ uid: row.uid, name: byUid.get(row.uid)?.name || '',
      isOwner: row.uid === uid, total: Number(row.total), drafts: Number(row.drafts), latestAt: Number(row.latestAt) }));
    const ownerThread = uid && this.account ? threads.find(p => p.uid === uid) || { uid, name: config.ownerAccountName || '', isOwner: true, total: 0, drafts: 0, latestAt: null } : null;
    const sorted = threads.filter(p => !p.isOwner).sort((a, b) => b.latestAt - a.latestAt || a.uid.localeCompare(b.uid));
    const filtered = sorted.filter(p => !view.q || p.uid.includes(view.q) || p.name.toLowerCase().includes(view.q.toLowerCase()));
    const selected = (view.uid === ownerThread?.uid ? ownerThread : threads.find(p => p.uid === view.uid)) || ownerThread || sorted[0] || null;
    view.uid = selected?.uid || '';
    view.offset = Math.min(view.offset, Math.max(0, Math.ceil((selected?.total || 0) / 10) - 1) * 10);
    view.peopleOffset = Math.min(view.peopleOffset, Math.max(0, Math.ceil(filtered.length / 20) - 1) * 20);
    const messages = selected ? this.contacts.messagePage(this.account, selected.uid, view.offset).map(m => {
      const person = byUid.get(m.uid);
      return { id: m.id, kind: m.kind || 'reply', uid: m.uid, isOwner: m.uid === uid, name: person?.name || '', state: m.state,
        at: m.at, text: m.text, draft: m.draft || '', evaluation: m.evaluation || '', reason: m.reason || '',
        eligibility: eligibility(person, people, config, ranks) };
    }) : [];
    return { accountUid: this.account, enabled: config.dmEnabled, autoSend: config.dmAutoSend,
      paused: this.paused, busy: !!this.busy, notice: this.notice || '', error: this.error || null,
      owner: uid && this.contacts.person(this.account, uid) ? annotate(this.contacts.person(this.account, uid)) : null,
      people: others.slice(contactsOffset, contactsOffset + 20).map(annotate), total: others.length,
      eligibleCount: Math.min(100, ranking.length), importPage: this.store.get('fanImport:' + this.account, 1),
      budget: this.contacts.budget(this.account, '', config, this.c.now()), messages,
      privateView: view, conversations: { owner: ownerThread, people: filtered.slice(view.peopleOffset, view.peopleOffset + 20),
        total: sorted.length, filteredTotal: filtered.length, selected, pageSize: 20, messagePageSize: 10 } };
  }
  assertIdle() {
    assert(!this.busy && !this.c.weekly?.busy && !this.c.store.active() && !this.c.scheduler.busy && !this.c.scheduler.starting && !this.c.installing && !this.c.metadataBusy,
      'RUN_BUSY', '请等待当前浏览、私信或环境准备结束。', 409);
  }
  background(operation) {
    this.assertIdle(); this.busy = true; this.error = null; this.notice = '正在检查…';
    this.job = Promise.resolve().then(() => { if (!this.c.closed) return operation(); }).catch(error => {
      if (!this.c.closed) { this.error = errorView(error); this.notice = this.error.message; }
    }).finally(() => { this.busy = false; });
    return { message: '操作已提交，进度会自动更新。' };
  }
  importFans(page) {
    assert(Number.isInteger(page) && page >= 1 && page <= 10000, 'CONTACT_PAGE', '粉丝页码无效。');
    return this.background(async () => {
      const value = await this.c.reader().call('contacts_page', { page });
      if (this.c.closed) return;
      uidOf(value?.accountUid);
      assert(Array.isArray(value.people) && value.people.length <= 100, 'CONTACT_DATA', '平台粉丝结果无效。');
      this.setAccount(value.accountUid);
      this.store.transaction(() => {
        for (const p of value.people) {
          assert(typeof p.name === 'string' && p.name.length <= 80, 'CONTACT_DATA', '粉丝昵称无效。');
          this.contacts.put(value.accountUid, uidOf(p.uid), { name: p.name, fan: true });
        }
        this.store.set('fanImport:' + value.accountUid, value.hasMore ? page + 1 : 1);
      });
      this.notice = `已导入第${page}页 ${value.people.length} 位粉丝；保留已有评分。` +
        (value.hasMore ? '可继续导入下一页。' : '本页已结束。') + '平台列表可能不完整；来信人还会单独核验粉丝关系。';
    });
  }
  rate({ uid, score, evaluation, blocked }) {
    this.assertIdle(); uidOf(uid);
    assert(this.account, 'CONTACT_ACCOUNT', '请先检查登录或导入粉丝。');
    const person = this.contacts.person(this.account, uid);
    assert(person, 'CONTACT_MISSING', '此联系人不存在。');
    assert(typeof blocked === 'boolean', 'INVALID_SCORE', '屏蔽选项无效。');
    return this.store.transaction(() => {
      const value = this.contacts.rate(this.account, uid, { score, evaluation, source: 'user' });
      this.contacts.put(this.account, uid, { blocked: blocked || !!person.platformBlocked, userBlocked: blocked });
      return { person: value, message: '评分已保存，回复资格立即重新计算。' };
    });
  }
  pause() { this.store.set('dmPaused', true); return { message: '私信已暂停；已发出的请求无法撤回。' }; }
  resume() { this.store.set('dmPaused', false); return { message: '私信已继续，仍受开关、排名和额度限制。' }; }
  allowed() { return !this.c.closed && this.store.config().dmEnabled && !this.paused; }
  async scan() {
    assert(this.allowed(), 'DM_DISABLED', '请先保存并开启私信功能，或继续已暂停的私信。', 409);
    return this.background(() => this.process());
  }
  async process() {
    const c = this.c;
    this.store.set('dmNextPoll', c.now() + this.store.config().dmPollSeconds * 1000);
    const binding = await c.host.requireBinding();
    assert(!binding.running, 'SESSION_BUSY', '等待原汇总对话空闲。', 409);
    if (!this.allowed()) return;
    const found = await c.reader().call('dm_inbox');
    if (!this.allowed()) return;
    uidOf(found?.accountUid);
    assert(Array.isArray(found.messages) && found.messages.length <= 20, 'DM_INBOX', '私信列表格式无效。');
    this.setAccount(found.accountUid);
    if (this.store.config().dmAutoSend) {
      for (const incoming of found.messages) {
        const m = this.contacts.message(keyOf(this.account, incoming));
        if (m?.state !== 'draft') continue;
        if (!this.allowed()) return;
        try { await this.send(m.id, true); } catch (error) { this.notice = errorView(error).message; }
      }
    }
    for (const incoming of [...found.messages].sort((a, b) => b.at - a.at)) {
      if (!this.allowed() || c.store.active()) return;
      uidOf(incoming.uid);
      assert(typeof incoming.id === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(incoming.id) &&
        typeof incoming.text === 'string' && incoming.text.trim() && incoming.text.length <= 2000 &&
        Number.isSafeInteger(incoming.at), 'DM_INBOX', '收到的消息格式无效。');
      const id = keyOf(this.account, incoming);
      if (this.contacts.message(id) || incoming.at < this.store.get('dmSince', c.now()) || incoming.uid === this.account) continue;
      const budget = this.contacts.budget(this.account, incoming.uid, this.store.config(), c.now());
      if (budget.evaluations >= budget.evaluationLimit) { this.notice = '今日私信评价额度已用完（0关闭）。'; return; }
      const actual = await c.reader().call('dm_thread', { uid: incoming.uid, expected_account: this.account });
      if (!this.allowed()) return;
      assert(actual?.accountUid === this.account && actual.uid === incoming.uid, 'ACCOUNT_CHANGED', '私信账号不匹配。');
      const previous = this.contacts.person(this.account, incoming.uid);
      if (!previous && actual.fan !== true && incoming.uid !== ownerUid(this.store.config())) continue;
      const person = this.contacts.put(this.account, incoming.uid, { fan: actual.fan === true,
        platformBlocked: actual.blocked === true, blocked: !!previous?.userBlocked || actual.blocked === true });
      const known = person.uid === ownerUid(this.store.config()) || person.fan;
      if (!known || person.blocked || actual.message?.id !== incoming.id || actual.message?.text !== incoming.text) continue;
      const m = this.contacts.reserveEvaluation({ id, platformId: incoming.id, accountUid: this.account, uid: incoming.uid,
        text: incoming.text, receivedAt: incoming.at, state: 'evaluating' }, this.store.config(), c.now());
      try { c.feedback.capturePrivate(m); } catch (error) { c.feedback.notice = '本条交流素材暂未保存：' + errorView(error).message; }
      const payload = { message: { id: m.platformId, text: m.text }, person, isOwner: person.uid === ownerUid(this.store.config()), messageId: id };
      const reserved = this.store.start({ id, kind: 'dm', sessionId: binding.sessionId, accountUid: this.account, now: c.now() });
      const run = this.store.update(id, { dmPayload: payload });
      if (reserved.fresh) { c.launch(id, () => c.execute(run)); await c.jobs.get(id); }
      if (this.allowed() && this.store.config().dmAutoSend && this.contacts.message(id)?.state === 'draft') {
        try { await this.send(id, true); } catch (error) { this.notice = errorView(error).message; }
      }
      if (!c.closed && !this.error) {
        const completed = this.contacts.message(id);
        if (completed?.state === 'failed') this.error = this.store.run(id)?.error || { message: completed.reason };
        this.notice = completed?.reason || '已完成本条私信评价，详情见下方。';
      }
      return;
    }
    this.notice = '检查完成，最近20个私聊中没有尚未处理的合格新文本来信。';
  }
  complete(run, raw) {
    const config = run.configSnapshot;
    const v = parsePrivate(raw, run, config), id = run.dmPayload.messageId;
    this.c.learning.checkOutput(v.reply, run.accountUid);
    this.c.privacy.check(v.reply, { session: run.sessionId, account: run.accountUid, recipient: run.dmPayload.person.uid });
    this.c.privacy.remember(run.id + ':output', run.sessionId, run.accountUid, run.dmPayload.person.uid, [v.evaluation, v.reply]);
    try {
      this.c.feedback.record({ account: run.accountUid, sender: run.dmPayload.person.uid, sourceId: run.id,
        text: run.dmPayload.message.text, scope: 'private_style', semantic: v.expression_feedback });
    } catch (error) { this.c.feedback.notice = '本条表达线索暂未保存：' + errorView(error).message; }
    return this.store.transaction(() => {
      const m = this.contacts.message(id);
      assert(m && m.accountUid === run.accountUid, 'DM_RECORD', '私信记录与任务不匹配。');
      if (m.state !== 'evaluating') return this.store.update(run.id, { state: 'completed', noteStatus: 'private' });
      const person = this.contacts.person(m.accountUid, m.uid);
      const updated = this.contacts.rate(m.accountUid, m.uid, { score: Math.max(0, Math.min(100, person.score + v.score_delta)),
        evaluation: v.evaluation, quote: v.evidence_quote, source: 'deepseek', messageId: m.id });
      const gate = eligibility(updated, this.contacts.all(m.accountUid), this.store.config());
      this.contacts.saveMessage({ ...m, state: v.should_reply ? 'draft' : 'skipped', draft: v.reply,
        draftPolicy: draftPolicy(config), draftScore: updated.score,
        evaluation: v.evaluation, reason: v.should_reply ? (gate.allowed ? '草稿已生成；等待发送模式、额度及最新来信核对。' : gate.reason) : '大肥鱼本次不准备回复。' });
      return this.store.update(run.id, { state: 'completed', noteStatus: 'private', waitReason: null });
    });
  }
  failed(run, message) {
    const m = run?.dmPayload && this.contacts.message(run.dmPayload.messageId);
    if (m?.state === 'evaluating') this.contacts.saveMessage({ ...m, state: 'failed', reason: message });
  }
  assertSend(m, auto) {
    assert(this.allowed() && (!auto || this.store.config().dmAutoSend), 'DM_DISABLED', '私信回复已关闭或暂停。', 409);
    assert(m?.state === 'draft' && m.accountUid === this.account, 'DM_RECORD', '该私信不属于当前账号或已处理。');
    this.c.learning.checkOutput(m.draft || '', m.accountUid);
    this.c.privacy.check(m.draft || '', { account: m.accountUid, recipient: m.uid });
    this.c.privacy.gate('dm:' + m.id, m.draft, auto, this.c.privacy.requiresPrivateReview(m.accountUid, m.uid));
    const gate = eligibility(this.contacts.person(m.accountUid, m.uid), this.contacts.all(m.accountUid), this.store.config());
    assert(gate.allowed && m.uid !== this.account, 'DM_NOT_ELIGIBLE', gate.reason, 409);
    const config = this.store.config(), b = this.contacts.budget(m.accountUid, m.uid, config, this.c.now());
    assert(b.replies < b.replyLimit && b.personReplies < b.personLimit, 'DM_LIMIT', '已达到每日或单联系人私信回复上限。', 409);
    assert(!b.latest || this.c.now() - b.latest >= config.dmMinIntervalSeconds * 1000, 'DM_INTERVAL', '尚未达到该联系人的最短回复间隔。', 409);
  }
  async send(id, auto = false) {
    let m = this.contacts.message(id);
    this.assertSend(m, auto);
    const obsolete = value => value.receivedAt < this.store.get('dmSince', Infinity) || value.draftPolicy !== draftPolicy(this.store.config()) ||
      value.draftScore !== this.contacts.person(value.accountUid, value.uid)?.score;
    if (obsolete(m)) {
      this.contacts.saveMessage({ ...m, state: 'skipped', reason: '身份、人设、评分或启用时间已变化，旧草稿不发送。' }); return;
    }
    const config = this.store.config();
    assert(m.draft?.trim() && m.draft.length <= config.dmMaxChars, 'DM_TEXT', '当前字数上限不允许此草稿。');
    const actual = await this.c.reader().call('dm_thread', { uid: m.uid, expected_account: m.accountUid });
    if (this.c.closed) return;
    assert(actual?.accountUid === m.accountUid && actual.uid === m.uid, 'ACCOUNT_CHANGED', '私信账号不匹配。');
    const before = this.contacts.person(m.accountUid, m.uid);
    this.contacts.put(m.accountUid, m.uid, { fan: actual.fan === true, platformBlocked: actual.blocked === true,
      blocked: !!before.userBlocked || actual.blocked === true });
    m = this.contacts.message(id); this.assertSend(m, auto);
    if (obsolete(m)) {
      this.contacts.saveMessage({ ...m, state: 'skipped', reason: '草稿依据已变化，未发送。' }); return;
    }
    if (actual.message?.id !== m.platformId || actual.message?.text !== m.text) {
      this.contacts.saveMessage({ ...m, state: 'skipped', reason: '对话有新消息或已被人工回复，旧草稿不发送。' }); return;
    }
    const current = this.store.config();
    assert(m.draft.length <= current.dmMaxChars, 'DM_TEXT', '草稿超过当前字数上限。');
    this.contacts.reserveSend(m, current, this.c.now());
    try {
      const sent = await this.c.reader().call('dm_reply', { uid: m.uid, expected_account: m.accountUid,
        message_id: m.platformId, reply: m.draft, owner_uid: ownerUid(current) });
      if (this.c.closed) return;
      const confirmed = sent?.confirmed === true && sent.accountUid === m.accountUid && sent.uid === m.uid && sent.messageId === m.platformId;
      this.contacts.saveMessage({ ...this.contacts.message(id), state: confirmed ? 'sent' : 'unknown',
        reason: confirmed ? '平台已确认回复。' : '发送结果未确认；不会自动重发，请到B站核对。' });
    } catch {
      if (!this.c.closed) this.contacts.saveMessage({ ...this.contacts.message(id), state: 'unknown', reason: '发送结果未确认；本次占额保留，不会重发。请到B站核对。' });
    }
  }
  sendManual(id, input = {}) { return this.background(async () => {
    const m = this.contacts.message(id);
    assert(m, 'DM_RECORD', '私信草稿不存在。');
    this.c.privacy.review('dm:' + id, m.draft, input, this.c.privacy.requiresPrivateReview(m.accountUid, m.uid));
    await this.send(id); this.notice = this.contacts.message(id)?.reason || '操作结束。';
  }); }
  forget(id) {
    this.assertIdle();
    const m = this.contacts.message(id), run = this.store.run(id);
    assert(m && m.accountUid === this.account && !['evaluating', 'sending'].includes(m.state) &&
      (!run || !['reading', 'awaiting_model', 'saving', 'needs_review'].includes(run.state)), 'DM_RECORD', '只能清理当前账号已结束的私信记录。');
    this.store.transaction(() => {
      this.contacts.saveMessage({ ...m, text: '', draft: '', evaluation: '', state: 'redacted', reason: '内容已删除，保留最小去重标记及计数。' });
      this.store.db.prepare("DELETE FROM runs WHERE id=? AND kind IN ('dm','dm_proactive')").run(id);
      this.store.db.prepare("DELETE FROM contact_scores WHERE account_uid=? AND uid=? AND json_extract(data,'$.messageId')=?")
        .run(m.accountUid, m.uid, id);
      const p = this.contacts.person(m.accountUid, m.uid);
      if (p?.lastMessageId === id) this.contacts.put(m.accountUid, m.uid, { evaluation: '原评价内容已清理；分数保留。', quote: '', lastMessageId: '' });
    });
    return { message: '私信内容、草稿及对应本地评价内容已清理。去重、计数和原对话消息保留。' };
  }
  start() { this.timer = setInterval(() => this.tick(), 15000); this.timer.unref?.(); }
  tick() {
    if (!this.allowed() || this.busy || this.c.store.active() || (this.c.store.openRound() && !this.c.scheduler.paused) || this.c.scheduler.busy ||
      this.c.scheduler.starting || this.c.weekly?.busy || this.c.installing || this.c.metadataBusy || this.c.now() < this.store.get('dmNextPoll', Infinity) ||
      !inActivity(this.c.now(), this.store.config())) return;
    this.background(() => this.process());
  }
  close() { clearInterval(this.timer); }
}
