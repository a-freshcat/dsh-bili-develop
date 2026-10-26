import { randomUUID } from 'node:crypto';
import { assert } from './errors.mjs';
import { digest } from './weekly-assets.mjs';
import { localDay } from './time.mjs';
import { noteForDeletion, deleteNote } from './notebook.mjs';
import { requestIdOf } from './decision.mjs';

const TERMINAL = ['preview', 'completed', 'skipped', 'failed', 'interrupted'];
const KINDS = ['video', 'interaction', 'probe'];
function dateBoundary(day, zone, end = false) {
  assert(/^\d{4}-\d{2}-\d{2}$/.test(day) && !Number.isNaN(Date.parse(day + 'T12:00:00Z')) &&
    new Date(day + 'T12:00:00Z').toISOString().slice(0, 10) === day, 'HISTORY_FILTER', '请填写有效日期。');
  const middle = Date.parse(day + 'T12:00:00Z'); let low = middle - 48 * 3600000, high = middle + 48 * 3600000;
  while (high - low > 1) {
    const mid = Math.floor((low + high) / 2), actual = localDay(mid, zone);
    if (end ? actual <= day : actual < day) low = mid; else high = mid;
  }
  return new Date(high).toISOString();
}
export function historyWhere(input = {}, zone = 'UTC', terminal = false) {
  assert(input && typeof input === 'object' && !Array.isArray(input) && Object.keys(input).every(k => ['q', 'kind', 'state', 'source', 'from', 'to'].includes(k)), 'HISTORY_FILTER', '记录筛选格式无效。');
  const filter = { q: '', kind: 'all', state: 'all', source: 'all', from: '', to: '', ...input };
  assert(typeof filter.q === 'string' && filter.q.length <= 100 && !/[\r\n\0]/.test(filter.q) && typeof filter.from === 'string' && typeof filter.to === 'string', 'HISTORY_FILTER', '搜索词或日期格式无效。');
  filter.q = filter.q.trim();
  assert(['all', ...KINDS].includes(filter.kind) && ['all', ...TERMINAL, 'reading', 'awaiting_model', 'saving', 'needs_review'].includes(filter.state) &&
    ['all', 'subtitle', 'asr', 'frames', 'comments', 'interaction', 'owner_mention'].includes(filter.source), 'HISTORY_FILTER', '记录类型、状态或内容来源无效。');
  assert(!filter.from || !filter.to || filter.from <= filter.to, 'HISTORY_FILTER', '开始日期不能晚于结束日期。');
  const clauses = ["kind IN ('video','interaction','probe')"], params = [];
  if (terminal) clauses.push("state IN ('preview','completed','skipped','failed','interrupted')");
  for (const key of ['kind', 'state']) if (filter[key] !== 'all') { clauses.push(key + '=?'); params.push(filter[key]); }
  if (filter.source !== 'all') { clauses.push(filter.source === 'owner_mention' ? "kind='video' AND json_extract(data,'$.source')=?" : "json_extract(data,'$.evidence.source')=?"); params.push(filter.source); }
  if (filter.q) {
    clauses.push("(instr(lower(bvid),lower(?))>0 OR instr(lower(COALESCE(json_extract(data,'$.evidence.title'),'')),lower(?))>0 OR instr(lower(COALESCE(json_extract(data,'$.preview.summary'),'')),lower(?))>0)");
    params.push(filter.q, filter.q, filter.q);
  }
  if (filter.from) { clauses.push('created_at>=?'); params.push(dateBoundary(filter.from, zone)); }
  if (filter.to) { clauses.push('created_at<?'); params.push(dateBoundary(filter.to, zone, true)); }
  return { filter, sql: clauses.join(' AND '), params };
}

export class History {
  constructor(c) { this.c = c; this.s = c.store; this.deleteFile = deleteNote; }
  status(filters, pendingView = {}) {
    return { filter: historyWhere(filters, this.s.config().timeZone).filter, totalAll: this.s.count(),
      pendingNotes: this.s.get('pendingHistoryNotes', []).length, pending: this.pending(pendingView), notice: this.notice || '' };
  }
  detail(id) {
    if (!id) return null;
    const run = this.s.run(requestIdOf(id)), account = this.c.social.account || this.s.get('commentAccount', '');
    return run && KINDS.includes(run.kind) && run.sessionId === this.s.get('binding')?.sessionId &&
      (!run.accountUid || run.accountUid === account) ? run : null;
  }
  /**
   * Outgoing items that were drafted or stopped but never published.
   *
   * Comments and DMs live in their own tables, which used to be reachable only
   * from the interaction and relationship tabs. The record page is the single
   * place a user looks for "what did it try to send", so both are joined here.
   * Only items that have not reached the platform are listed: `sent` and
   * `unknown` attempts already have a run record and are never re-offered.
   */
  pending(view = {}) {
    assert(view && typeof view === 'object' && !Array.isArray(view) && Object.keys(view).every(k => ['filter', 'offset'].includes(k)) &&
      ['all', 'manual', 'comment', 'dm'].includes(view.filter ?? 'manual') && Number.isInteger(view.offset ?? 0) && (view.offset ?? 0) >= 0 && (view.offset ?? 0) <= 1000000,
    'HISTORY_PENDING', '待处理筛选或分页无效。');
    const account = this.c.social.account || this.s.get('commentAccount', '');
    const config = this.s.config(), strictReview = this.c.comments.requiresPrivacyReview();
    const needsManual = text => /隐私|PRIVACY|复审|人工|拦截/.test(String(text || ''));
    const comments = this.s.db.prepare("SELECT d.data,r.id record_id,json_extract(r.data,'$.evidence.title') title FROM comment_drafts d LEFT JOIN runs r ON r.id=d.id WHERE d.account_uid=? AND d.state IN ('draft','cancelled') AND COALESCE(json_extract(d.data,'$.contentCleared'),0)=0 ORDER BY d.rowid DESC")
      .all(account).map(row => {
        const d = JSON.parse(row.data);
        const manualReason = /基础人设|已变化|重新读取|重新生成/.test(d.reason || '') ? '设置或原文已变化，需要重新生成' :
          strictReview ? '需要本条隐私审核' : needsManual(d.reason) ? d.reason : config.commentMode === 'manual' ? '当前评论方式为逐条确认' :
            d.state === 'cancelled' ? '已取消，需要核对记录' : config.commentMode === 'auto' && !d.autoEligible ? '旧草稿没有自动发送资格，需要人工核对' : '';
        return {
        kind: 'comment', id: d.id, accountUid: d.accountUid || '', bvid: d.bvid || '',
        title: String(row.title || d.bvid || '视频评论'), recordAvailable: !!row.record_id,
        targetId: d.target?.id || '', targetText: String(d.target?.text || '').slice(0, 120),
        text: String(d.text || '').slice(0, 200), at: d.createdAt || null,
        state: d.state, reason: String(d.reason || ''),
        manual: !!manualReason, manualReason,
        url: d.bvid ? 'https://www.bilibili.com/video/' + d.bvid + '/' + (d.target ? '#reply' + d.target.id : '') : '',
      }; });
    const messages = this.s.db.prepare("SELECT data FROM private_messages WHERE account_uid=? AND state IN ('draft','failed','skipped','evaluating') AND COALESCE(json_extract(data,'$.contentCleared'),0)=0 ORDER BY at_ms DESC,id DESC")
      .all(account).map(row => JSON.parse(row.data)).map(m => {
        const manualReason = needsManual(m.reason) ? m.reason : m.state === 'failed' ? '回复生成失败，需要查看原因' :
          m.state === 'draft' && !config.dmAutoSend ? '私信自动发送未开启，需要人工确认' : '';
        return {
        kind: 'dm', id: m.id, accountUid: m.accountUid || '', uid: m.uid || '',
        title: (this.c.social.contacts.person(account, m.uid)?.name || 'UID ' + m.uid) + ' · 私信',
        text: String(m.draft || '').slice(0, 200), received: String(m.text || '').slice(0, 120),
        at: m.at || null, state: m.state, reason: String(m.reason || ''),
        manual: !!manualReason, manualReason,
        url: m.uid ? 'https://space.bilibili.com/' + m.uid : '',
      }; });
    const items = [...comments, ...messages].sort((a, b) => Number(b.manual) - Number(a.manual) || (b.at || 0) - (a.at || 0) || b.id.localeCompare(a.id));
    const filter = view.filter ?? 'manual', selected = items.filter(item => filter === 'all' || (filter === 'manual' ? item.manual : item.kind === filter));
    const pageSize = 8, offset = Math.min(view.offset || 0, Math.max(0, Math.ceil(selected.length / pageSize) - 1) * pageSize);
    const page = selected.slice(offset, offset + pageSize).map(item => {
      if (item.kind !== 'dm') return item;
      const newer = this.s.db.prepare("SELECT COUNT(*) n FROM private_messages WHERE account_uid=? AND uid=? AND state<>'redacted' AND (at_ms>? OR (at_ms=? AND id>?))")
        .get(account, item.uid, item.at, item.at, item.id).n;
      return { ...item, messageOffset: Math.floor(Number(newer) / 10) * 10 };
    });
    return { accountUid: account, total: items.length, manual: items.filter(i => i.manual).length,
      comments: comments.length, messages: messages.length, items: page, filteredTotal: selected.length, filter, offset, pageSize };
  }
  preview(filters) {
    this.c.social.assertIdle();
    const binding = this.s.get('binding'); assert(binding?.path, 'BINDING_NOT_READY', '请先绑定原工作区。');
    const query = historyWhere(filters, this.s.config().timeZone, true);
    const rows = this.s.db.prepare('SELECT data FROM runs WHERE ' + query.sql + ' AND json_extract(data,\'$.sessionId\')=? ORDER BY created_at,id LIMIT 101')
      .all(...query.params, binding.sessionId).map(r => JSON.parse(r.data));
    const selected = rows.slice(0, 100);
    assert(selected.length, 'HISTORY_EMPTY', '当前筛选下没有可清理的已结束记录。');
    const preview = { token: randomUUID(), sessionId: binding.sessionId, workspace: binding.path, expiresAt: this.c.now() + 300000,
      records: selected.map(r => ({ id: r.id, hash: digest(r) })) };
    this.s.set('historyDeletePreview', preview);
    return { token: preview.token, count: selected.length, more: rows.length > 100, expiresAt: preview.expiresAt,
      records: selected.map(r => ({ id: r.id, title: String(r.evidence?.title || r.bvid || '接入检查').slice(0, 120), createdAt: r.createdAt })),
      sample: selected.slice(0, 5).map(r => ({ title: String(r.evidence?.title || r.bvid || '接入检查').slice(0, 120), createdAt: r.createdAt })),
      message: '请核对本批记录；最多100条，仅清理已结束记录，次数、去重、独立学习和原对话保留。' };
  }
  check(run) {
    const binding = this.s.get('binding');
    assert(run && KINDS.includes(run.kind) && TERMINAL.includes(run.state), 'RECORD_BUSY', '只能删除已结束的浏览或接入检查记录。', 409);
    assert(binding?.sessionId === run.sessionId, 'BINDING_MISMATCH', '记录与当前工作区绑定不一致。');
    noteForDeletion(binding.path, run);
    return { id: run.id, workspace: binding.path, sessionId: binding.sessionId };
  }
  remove(runs) {
    this.c.social.assertIdle();
    const jobs = runs.map(run => this.check(run));
    const previous = this.s.get('pendingHistoryNotes', []);
    assert(previous.length + jobs.length <= 1000, 'HISTORY_NOTES', '待清理笔记较多，请先重试清理剩余笔记。');
    this.s.transaction(() => {
      for (const r of runs) {
        this.c.comments.drop(r.id);
        this.s.db.prepare('DELETE FROM interaction_scans WHERE source_id=?').run(r.id);
        if (r.interactionOrigin === 'notification') this.s.db.prepare('DELETE FROM interaction_scans WHERE source_id=?').run(r.sourceRunId);
        this.s.db.prepare('DELETE FROM runs WHERE id=?').run(r.id);
      }
      const pending = [...new Map([...previous, ...jobs].map(j => [j.id, j])).values()];
      this.s.set('pendingHistoryNotes', pending); this.s.set('historyDeletePreview', null);
    });
    this.retryNotes();
    const left = this.s.get('pendingHistoryNotes', []).length;
    return { removed: runs.length, pendingNotes: left, message: runs.length + '条记录已清理。计数、去重、学习和原对话保留。' + (left ? '仍有' + left + '篇笔记待清理，可重试。' : '对应笔记已清理。') };
  }
  confirm(input) {
    this.c.social.assertIdle();
    const p = this.s.get('historyDeletePreview'), binding = this.s.get('binding');
    assert(input.confirmed === true && p?.token === input.token && this.c.now() <= p.expiresAt && p.workspace === binding?.path && p.sessionId === binding?.sessionId,
      'HISTORY_STALE', '清理预览已过期或绑定变化，请重新预览。');
    const runs = p.records.map(item => {
      const run = this.s.run(item.id);
      assert(run && digest(run) === item.hash, 'HISTORY_STALE', '预览中的记录已变化，请重新预览后确认。'); return run;
    });
    return this.remove(runs);
  }
  retryNotes() {
    this.c.social.assertIdle();
    const binding = this.s.get('binding'), pending = [];
    for (const j of this.s.get('pendingHistoryNotes', [])) {
      if (j.workspace !== binding?.path || j.sessionId !== binding?.sessionId) { pending.push(j); continue; }
      try { this.deleteFile(j.workspace, { id: j.id }); } catch { pending.push(j); }
    }
    this.s.set('pendingHistoryNotes', pending);
    this.notice = pending.length ? '部分笔记暂时无法删除；记录和次数已正确保存，可稍后重试。' : '';
    return { message: pending.length ? '仍有' + pending.length + '篇笔记待清理。' : '待清理笔记已处理。' };
  }
}
