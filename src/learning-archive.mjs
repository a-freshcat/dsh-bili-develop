import { createHash, randomUUID } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, writeFileSync, renameSync, unlinkSync } from 'node:fs';
import { join, relative } from 'node:path';
import { assert } from './errors.mjs';
import { managed } from './weekly-assets.mjs';

const STATES = ['candidate', 'active', 'reduced', 'inactive', 'blocked', 'archived'];
const DEFAULT_VIEW = { account: '', q: '', state: 'all', reviewOffset: 0, reviewFrom: '', reviewTo: '', reviewState: 'all', eventOffset: 0, entity: '', sourceOffset: 0 };
const normal = value => value.normalize('NFKC').toLowerCase().replace(/\s/g, '');
const dayValid = day => /^\d{4}-\d{2}-\d{2}$/.test(day) && !Number.isNaN(Date.parse(day + 'T12:00:00Z')) && new Date(day + 'T12:00:00Z').toISOString().slice(0, 10) === day;
const page = (offset, total, size) => total ? Math.min(offset, Math.floor((total - 1) / size) * size) : 0;
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const block = value => {
  const text = String(value || ''), length = Math.max(3, ...[...text.matchAll(/`+/g)].map(m => m[0].length + 1));
  const fence = '`'.repeat(length); return fence + 'text\n' + text + '\n' + fence;
};
const summary = value => value ? Object.fromEntries(['state', 'version', 'expression', 'traits'].filter(k => value[k] !== undefined).map(k => [k, value[k]])) : null;

export function learningView(input = {}, account = '') {
  assert(input && typeof input === 'object' && !Array.isArray(input) && Object.keys(input).every(k => Object.hasOwn(DEFAULT_VIEW, k)), 'LEARNING_FILTER', '学习档案筛选无效。');
  const view = { ...DEFAULT_VIEW, ...input };
  assert(typeof view.account === 'string' && (!view.account || /^[1-9]\d{0,19}$/.test(view.account)) &&
    typeof view.q === 'string' && view.q.length <= 100 && !/[\r\n\0]/.test(view.q) && ['all', ...STATES].includes(view.state) &&
    ['all', 'reading', 'completed', 'failed'].includes(view.reviewState) && typeof view.entity === 'string' &&
    (!view.entity || /^[A-Za-z0-9_-]{8,100}$/.test(view.entity)), 'LEARNING_FILTER', '搜索词、状态或档案对象无效。');
  for (const key of ['reviewOffset', 'eventOffset', 'sourceOffset']) assert(Number.isInteger(view[key]) && view[key] >= 0 && view[key] <= 1000000, 'LEARNING_PAGE', '学习档案分页无效。');
  for (const key of ['reviewFrom', 'reviewTo']) assert(typeof view[key] === 'string' && (!view[key] || dayValid(view[key])), 'LEARNING_FILTER', '请填写有效的复盘日期。');
  assert(!view.reviewFrom || !view.reviewTo || view.reviewFrom <= view.reviewTo, 'LEARNING_FILTER', '开始日期不能晚于结束日期。');
  return view.account && view.account !== account ? { ...DEFAULT_VIEW, account } : { ...view, account, q: view.q.trim() };
}

export class LearningArchive {
  constructor(learning) { this.l = learning; this.db = learning.db; this.s = learning.store; }
  status(offset = 0, input = {}) {
    assert(Number.isInteger(offset) && offset >= 0 && offset <= 1000000, 'LEARNING_PAGE', '学习分页无效。');
    const account = this.l.account, view = learningView(input, account);
    if (input.account && input.account !== account) offset = 0;
    const count = (table, where, args) => Number(this.db.prepare('SELECT COUNT(*) n FROM ' + table + ' WHERE ' + where).get(...args).n);
    const clauses = ['account_uid=?'], args = [account];
    if (view.state !== 'all') { clauses.push("json_extract(data,'$.state')=?"); args.push(view.state); }
    if (view.q) { clauses.push("(instr(normal,?)>0 OR instr(lower(json_extract(data,'$.meaning')),lower(?))>0 OR instr(lower(json_extract(data,'$.context')),lower(?))>0)"); args.push(normal(view.q), view.q, view.q); }
    const where = clauses.join(' AND '), total = count('learning_entries', where, args); offset = page(offset, total, 10);
    const annotate = e => {
      const last = this.db.prepare("SELECT id,data FROM learning_events WHERE account_uid=? AND entity_id=? AND json_extract(data,'$.action')<>'draft_use' ORDER BY id DESC LIMIT 1").get(account, e.id);
      return { ...e, rollbackEventId: last && JSON.parse(last.data).before && e.state !== 'blocked' ? Number(last.id) : null };
    };
    const entries = this.db.prepare('SELECT data FROM learning_entries WHERE ' + where + ' ORDER BY rowid DESC LIMIT 10 OFFSET ?').all(...args, offset).map(r => annotate(JSON.parse(r.data)));
    let focus = null;
    if (view.entity && view.entity !== 'iteration') {
      const e = this.l.entry(view.entity); assert(e?.accountUid === account, 'LEARNING_ENTRY', '该学习档案不存在或不属于当前账号。');
      const sourceTotal = count('learning_evidence', 'entry_id=?', [e.id]); view.sourceOffset = page(view.sourceOffset, sourceTotal, 10);
      const sources = this.db.prepare('SELECT data FROM learning_evidence WHERE entry_id=? ORDER BY bvid LIMIT 10 OFFSET ?').all(e.id, view.sourceOffset).map(r => JSON.parse(r.data));
      focus = { entry: annotate(e), sources, sourceTotal, sourceOffset: view.sourceOffset, sourcePageSize: 10 };
    }
    const reviewArgs = [account], reviewClauses = ['account_uid=?'];
    if (view.reviewState !== 'all') { reviewClauses.push('state=?'); reviewArgs.push(view.reviewState); }
    for (const [key, operator] of [['reviewFrom', '>='], ['reviewTo', '<=']]) if (view[key]) { reviewClauses.push("json_extract(data,'$.day')" + operator + '?'); reviewArgs.push(view[key]); }
    const reviewWhere = reviewClauses.join(' AND '), reviewTotal = count('learning_reviews', reviewWhere, reviewArgs);
    view.reviewOffset = page(view.reviewOffset, reviewTotal, 5);
    const binding = this.s.get('binding');
    const reviews = this.db.prepare('SELECT data FROM learning_reviews WHERE ' + reviewWhere + ' ORDER BY end_ms DESC,id DESC LIMIT 5 OFFSET ?').all(...reviewArgs, view.reviewOffset).map(row => {
      const r = JSON.parse(row.data);
      return { ...Object.fromEntries(['id', 'day', 'zone', 'start', 'end', 'state', 'stats', 'comparison', 'report', 'direction', 'creativeIdeas', 'error', 'sources', 'omittedSources', 'iterationBefore', 'iterationAfter', 'expressionChanges'].filter(k => r[k] !== undefined).map(k => [k, r[k]])), exportable: this.inScope(r, binding) && r.state !== 'reading' };
    });
    const eventArgs = [account], eventWhere = 'account_uid=?' + (view.entity ? ' AND entity_id=?' : ''); if (view.entity) eventArgs.push(view.entity);
    const eventTotal = count('learning_events', eventWhere, eventArgs); view.eventOffset = page(view.eventOffset, eventTotal, 10);
    const events = this.db.prepare('SELECT id,at_ms,data FROM learning_events WHERE ' + eventWhere + ' ORDER BY id DESC LIMIT 10 OFFSET ?').all(...eventArgs, view.eventOffset).map(row => {
      const e = JSON.parse(row.data); return { id: Number(row.id), at: new Date(row.at_ms).toISOString(), entity: e.entity, action: e.action, reason: e.reason, source: e.source,
        expression: e.after?.expression || e.before?.expression || '', before: summary(e.before), after: summary(e.after) };
    });
    const counts = Object.fromEntries(STATES.map(s => [s, 0]));
    for (const row of this.db.prepare("SELECT json_extract(data,'$.state') state,COUNT(*) n FROM learning_entries WHERE account_uid=? GROUP BY json_extract(data,'$.state')").all(account)) counts[row.state] = Number(row.n);
    return { entries, total, totalAll: count('learning_entries', 'account_uid=?', [account]), offset, counts, view, focus, reviews, events,
      reviewPage: { offset: view.reviewOffset, total: reviewTotal, pageSize: 5 }, eventPage: { offset: view.eventOffset, total: eventTotal, pageSize: 10 }, archiveNotice: this.notice || '' };
  }
  inScope(r, binding) {
    return !!binding && r.accountUid === this.l.account && r.id === 'learn-' + hash([r.accountUid, binding.sessionId, r.start, r.end]).slice(0, 40) &&
      (!r.sessionId || r.sessionId === binding.sessionId) && (!r.workspace || r.workspace === binding.path);
  }
  write(r, binding) {
    assert(this.inScope(r, binding) && ['completed', 'failed'].includes(r.state), 'LEARNING_EXPORT', '只能将当前账号、原对话的已结束复盘导出到原工作区。');
    const directory = managed(binding.path, ['.bilibili-harness', 'learning-reviews', r.accountUid]), target = join(directory, r.id + '.md');
    const traits = value => (value?.traits || []).map(t => '- ' + t.text + '\n  原因：' + t.reason).join('\n') || '本次没有迭代条目。';
    const text = ['# 大肥鱼的日终学习档案', '日期：' + r.day + '；时区：' + r.zone + '；状态：' + r.state,
      '唯一对话：' + binding.sessionId, '记录：' + r.id, '这是数据库的阅读投影，重新导出会覆盖本文件；不读取它作为模型指令。',
      '本文件记录该次比较的取舍，之后的回滚和禁用以面板中的当前状态及变更档案为准。', '',
      '本次参考知识包：' + ((r.knowledgePacks || []).map(p => p.id + ' v' + p.version).join('、') || '无'),
      '## 与旧记忆的比较', block(r.comparison || r.error || ''), '## 比较前的迭代人设', block(traits(r.iterationBefore)),
      '## 本次选择后的迭代人设', block(traits(r.iterationAfter || r.iterationBefore)), '## 表达的取舍',
      block((r.expressionChanges || []).map(e => e.expression + '：' + e.action + '；' + e.reason).join('\n') || '本次没有表达状态变化。'),
      ...(r.report ? ['## 学习汇报', block(r.report)] : []), ...(r.direction ? ['## 后续探索方向', block(r.direction)] : []),
      ...((r.creativeIdeas || []).length ? ['## 不足与创意提案（不自动执行）', block(r.creativeIdeas.map(i => '不足：' + i.issue + '\n想法：' + i.idea + '\n小实验：' + i.trial + '\n理由：' + i.reason).join('\n\n'))] : []),
      '## 实际统计', block(JSON.stringify(r.stats || {}, null, 2)), '## 公开材料来源',
      ...(r.sources || []).map(s => s.kind === 'feedback' ? '- ' + (s.scope === 'private_dialogue' ? '私信对话复盘线索（已脱敏，不含原文与身份，不代表批评）' : s.scope === 'private_style' ? '交流表达建议（已脱敏，不含私信原文与身份）' : '公开回复的表达建议') + '\n' + block(s.summary || '') +
        (s.scope === 'public_reply' && /^https:\/\/www\.bilibili\.com\/video\/BV[A-Za-z0-9]{10}\/#reply\d+$/.test(s.url || '') ? '\n[查看公开回复](' + s.url + ')' : '') :
        /^BV[0-9A-Za-z]{10}$/.test(s.bvid) ? '- [' + String(s.title || s.bvid).replace(/[\[\]\\\r\n<>]/g, ' ') + '](https://www.bilibili.com/video/' + s.bvid + ')\n' + block(s.summary || '') : '- 来源标识保留在数据库中。'),
      r.omittedSources ? '本轮还有' + r.omittedSources + '条材料未提供给模型，不能视作已比较。' : '', ''].join('\n');
    assert(Buffer.byteLength(text, 'utf8') <= 200000, 'LEARNING_EXPORT', '复盘档案超出本地导出上限。');
    if (existsSync(target)) {
      assert(lstatSync(target).isFile() && !lstatSync(target).isSymbolicLink(), 'NOTE_PATH', '学习档案文件不能是链接或目录。');
      if (lstatSync(target).size <= 200000 && readFileSync(target, 'utf8') === text) return relative(binding.path, target);
    }
    const temporary = join(directory, '.' + randomUUID() + '.tmp');
    try { writeFileSync(temporary, text, { encoding: 'utf8', mode: 0o600 }); renameSync(temporary, target); }
    finally { if (existsSync(temporary)) unlinkSync(temporary); }
    return relative(binding.path, target);
  }
  projectRecent(binding) {
    let failed = 0;
    for (const r of this.l.reviews()) if (this.inScope(r, binding) && r.state !== 'reading') {
      try { this.write(r, binding); } catch { failed++; }
    }
    this.notice = failed ? '复盘已保存在数据库，部分工作区档案未写入，可展开对应复盘重试导出。' : '';
  }
  async export({ reviewId }) {
    this.l.c.social.assertIdle(); const binding = await this.l.c.host.requireBinding(); this.l.c.social.assertIdle();
    const row = this.db.prepare('SELECT data FROM learning_reviews WHERE id=? AND account_uid=?').get(reviewId, this.l.account);
    assert(row, 'LEARNING_EXPORT', '这份复盘不存在或不属于当前账号。');
    const path = this.write(JSON.parse(row.data), binding); this.notice = '';
    return { path, message: '复盘已导出到原工作区：' + path + '。未重复调用模型。' };
  }
}
