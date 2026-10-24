import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { PluginError } from './errors.mjs';
import { dayWindow } from './time.mjs';
import { historyWhere } from './history.mjs';

const ACTIVE = ['reading', 'awaiting_model', 'saving'];
export const HISTORY_PAGE_SIZE = 10;
export const DEFAULT_CONFIG = Object.freeze({
  persona: '保持友善、好奇、简洁。只依据实际读到的内容评价，不捏造经历或视频画面。',
  pythonPath: '',
  maxContentChars: 18000,
  commentMaxChars: 160,
  autoEnabled: false, keywords: [], dailyRoundLimit: 3, videosPerRound: 1, dailyAnalysisLimit: 10,
  intervalMinutes: 60, roundTimeoutMinutes: 10,
  browseTagEnabled: false, browseTags: [], browseTagMatch: 'any',
  browseMode: 'search', dailyBrowseChoiceLimit: 3,
  privacyBlockedTerms: [],
  timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC', activityStart: '09:00', activityEnd: '23:00',
  asrEnabled: false, asrModelPath: '', asrMaxSeconds: 180, dailyAudioSeconds: 1800,
  dailyAudioRequests: 10, audioTimeoutSeconds: 300,
  asrDownloadModel: 'small', asrDownloadSource: 'official',
  ownerAccountEnabled: false, ownerAccountUid: '', ownerAccountName: '', ownerAttitudeEnabled: false,
  dmEnabled: false, dmAutoSend: false, dmDailyReplyLimit: 20, dmPerPersonDailyLimit: 3,
  dmDailyEvaluationLimit: 50, dmPollSeconds: 60, dmMaxChars: 300, dmMinIntervalSeconds: 120,
  autoFollowEnabled: false, autoFollowDailyLimit: 3, autoFollowMinIntervalSeconds: 3600,
  dmProactiveEnabled: false, dmProactiveDailyLimit: 3,
  commentMode: 'preview', dailyCommentLimit: 5, perRoundCommentLimit: 1, commentMinIntervalSeconds: 300,
  commentMentionsEnabled: false, dailyMentionLimit: 5, mentionsPerComment: 1, mentionMinIntervalSeconds: 3600,
  mentionTargets: [],
  interactionKeywords: [], ownerCommentReplyEnabled: false, ownerMentionPollSeconds: 120, interactionTopLimit: 1, interactionSubLimit: 1, dailyInteractionEvaluationLimit: 20,
  learningEnabled: false, learningDailyTime: '00:10', learningDailyReport: false,
  learningReportDetail: 'brief', learningDirectionSuggestions: true, learningAdvice: '',
  learningDailyReviewLimit: 3,
  learningFeedbackEnabled: true,
  learningCreativeIdeas: true,
  weeklyAutoDraft: false, weeklyDay: 1, weeklyTime: '00:20', weeklyMinSources: 3,
  weeklyDailyDraftLimit: 2, weeklyDailyPublishLimit: 1, weeklyMinIntervalHours: 168,
  weeklyAutoImage: true,
});
export class Store {
  constructor(file) {
    this.file = file;
    if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(file);
    this.db.exec(`
      PRAGMA journal_mode=WAL;
      PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS runs (
        id TEXT PRIMARY KEY, kind TEXT NOT NULL, bvid TEXT NOT NULL,
        account_uid TEXT NOT NULL DEFAULT '', state TEXT NOT NULL,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL, data TEXT NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS one_active_run
      ON runs ((1)) WHERE state IN ('reading','awaiting_model','saving');
      CREATE TABLE IF NOT EXISTS usage_ledger (
        id TEXT PRIMARY KEY, kind TEXT NOT NULL, bvid TEXT NOT NULL DEFAULT '', at_ms INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS usage_time ON usage_ledger(at_ms,kind);
      INSERT OR IGNORE INTO usage_ledger(id,kind,bvid,at_ms)
        SELECT 'analysis:'||id,'analysis',bvid,CAST(strftime('%s',created_at) AS INTEGER)*1000
        FROM runs WHERE kind='video';
      CREATE TABLE IF NOT EXISTS rounds (id TEXT PRIMARY KEY,state TEXT NOT NULL,data TEXT NOT NULL);
      CREATE UNIQUE INDEX IF NOT EXISTS one_open_round ON rounds ((1))
        WHERE state IN ('queued','searching','running','paused','waiting');
      CREATE TABLE IF NOT EXISTS seen_videos (
        account_uid TEXT NOT NULL,bvid TEXT NOT NULL,PRIMARY KEY(account_uid,bvid)
      );
      INSERT OR IGNORE INTO seen_videos SELECT account_uid,bvid FROM runs
        WHERE kind='video' AND account_uid<>'';
      CREATE TABLE IF NOT EXISTS audio_jobs (
        id TEXT PRIMARY KEY,at_ms INTEGER NOT NULL,seconds INTEGER NOT NULL,state TEXT NOT NULL,data TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS audio_usage_time ON audio_jobs(at_ms);
    `);
  }
  get(key, fallback = null) {
    const row = this.db.prepare('SELECT value FROM kv WHERE key=?').get(key);
    return row ? JSON.parse(row.value) : structuredClone(fallback);
  }
  set(key, value) {
    this.db.prepare('INSERT INTO kv VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value')
      .run(key, JSON.stringify(value));
    return value;
  }
  config() { return { ...DEFAULT_CONFIG, ...this.get('config', {}) }; }
  transaction(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  run(id) {
    const row = this.db.prepare('SELECT data FROM runs WHERE id=?').get(id);
    return row ? JSON.parse(row.data) : null;
  }
  start({ id, kind, bvid = '', sessionId, source = 'manual', roundId, accountUid = '', now = Date.now(), admit }) {
    return this.transaction(() => {
      const existing = this.run(id);
      if (existing) {
        if (existing.kind !== kind || existing.bvid !== bvid) {
          throw new PluginError('REQUEST_CONFLICT', '同一请求标识已用于另一个任务。', 409);
        }
        return { run: existing, fresh: false };
      }
      if (this.active()) throw new PluginError('RUN_BUSY', '已有任务正在执行，请等待或查看其状态。', 409);
      const round = roundId && this.round(roundId);
      if (roundId && (!round || !['running', 'waiting'].includes(round.state)))
        throw new PluginError('ROUND_NOT_READY', '本轮已暂停或结束。', 409);
      if (kind === 'video') this.charge('analysis', id, bvid, this.config(), now);
      if (admit) admit();
      const time = new Date(now).toISOString();
      const run = { id, kind, bvid, sessionId, source, roundId, accountUid, state: 'reading', createdAt: time, updatedAt: time };
      this.db.prepare('INSERT INTO runs(id,kind,bvid,account_uid,state,created_at,updated_at,data) VALUES(?,?,?,?,?,?,?,?)')
        .run(id, kind, bvid, accountUid, run.state, time, time, JSON.stringify(run));
      if (round) {
        this.updateRound(roundId, { state: 'running', cursor: round.cursor + 1,
          analysisIds: [...round.analysisIds, id], lastRunId: id });
        this.markSeen(accountUid, bvid);
      }
      return { run, fresh: true };
    });
  }
  update(id, patch) {
    const before = this.run(id);
    if (!before) throw new PluginError('RUN_NOT_FOUND', '任务不存在。', 404);
    const run = { ...before, ...patch, id: before.id, updatedAt: new Date().toISOString() };
    this.db.prepare('UPDATE runs SET state=?,account_uid=?,updated_at=?,data=? WHERE id=?')
      .run(run.state, run.accountUid || '', run.updatedAt, JSON.stringify(run), id);
    return run;
  }
  active() {
    const row = this.db.prepare('SELECT data FROM runs WHERE state IN (?,?,?) LIMIT 1').get(...ACTIVE);
    return row ? JSON.parse(row.data) : null;
  }
  list(limit = 20, offset = 0, filters = {}) {
    const q = historyWhere(filters, this.config().timeZone);
    return this.db.prepare('SELECT data FROM runs WHERE ' + q.sql + ' ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?')
      .all(...q.params, limit, offset).map(row => JSON.parse(row.data));
  }
  count(filters = {}) {
    const q = historyWhere(filters, this.config().timeZone);
    return Number(this.db.prepare('SELECT COUNT(*) AS n FROM runs WHERE ' + q.sql).get(...q.params).n);
  }
  window(config, now, persist = false) {
    const before = this.get('budgetWindow');
    if (before && now < before.end) return before;
    const window = dayWindow(now, config.timeZone);
    if (before && before.zone !== config.timeZone && now < before.end + 86400000) {
      window.start = before.end;
      while (window.end < before.end + 86400000) window.end = dayWindow(window.end, config.timeZone).end;
    }
    if (persist) this.set('budgetWindow', window);
    return window;
  }
  budget(config, now = Date.now()) {
    const window = this.window(config, now);
    const rows = this.db.prepare('SELECT kind,COUNT(*) AS n FROM usage_ledger WHERE at_ms>=? AND at_ms<? GROUP BY kind')
      .all(window.start, window.end);
    const counts = Object.fromEntries(rows.map(row => [row.kind, Number(row.n)]));
    const unique = this.db.prepare("SELECT COUNT(DISTINCT bvid) AS n FROM usage_ledger WHERE kind='analysis' AND at_ms>=? AND at_ms<?")
      .get(window.start, window.end).n;
    return { ...window, analyses: counts.analysis || 0, rounds: counts.round || 0, uniqueVideos: Number(unique),
      analysisLimit: config.dailyAnalysisLimit, roundLimit: config.dailyRoundLimit };
  }
  charge(kind, id, bvid, config, now) {
    const usage = this.budget(config, now);
    const limit = kind === 'analysis' ? usage.analysisLimit : usage.roundLimit;
    const count = kind === 'analysis' ? usage.analyses : usage.rounds;
    if (count >= limit) throw new PluginError(kind === 'analysis' ? 'ANALYSIS_LIMIT' : 'ROUND_LIMIT',
      kind === 'analysis' ? '已达到当天视频分析上限。' : '已达到当天浏览轮次上限（0表示关闭）。', 409);
    this.window(config, now, true);
    this.db.prepare('INSERT INTO usage_ledger VALUES(?,?,?,?)').run(kind + ':' + id, kind, bvid, now);
  }
  round(id) { const row = this.db.prepare('SELECT data FROM rounds WHERE id=?').get(id); return row ? JSON.parse(row.data) : null; }
  openRound() {
    const row = this.db.prepare("SELECT data FROM rounds WHERE state IN ('queued','searching','running','paused','waiting') LIMIT 1").get();
    return row ? JSON.parse(row.data) : null;
  }
  reserveRound(round, config, now) {
    return this.transaction(() => {
      const existing = this.round(round.id);
      if (existing) return { round: existing, fresh: false };
      if (this.openRound() || this.active()) throw new PluginError('RUN_BUSY', '已有浏览任务，请等待或先暂停。', 409);
      const budget = this.budget(config, now);
      if (budget.analyses >= budget.analysisLimit) throw new PluginError('ANALYSIS_LIMIT', '已达到当天视频分析上限。', 409);
      this.charge('round', round.id, '', config, now);
      this.db.prepare('INSERT INTO rounds VALUES(?,?,?)').run(round.id, round.state, JSON.stringify(round));
      this.set('nextRunAt', now + config.intervalMinutes * 60000);
      if (round.browseMode !== 'autonomous') {
        this.set('keywordCursor', round.keywordCursor + 1);
        this.set('searchPages', { ...this.get('searchPages', {}), [round.searchKey || round.keyword]: round.page >= 20 ? 1 : round.page + 1 });
      }
      return { round, fresh: true };
    });
  }
  updateRound(id, patch) {
    const before = this.round(id);
    if (!before) throw new PluginError('ROUND_NOT_FOUND', '浏览轮次不存在。');
    const value = { ...before, ...patch, id };
    this.db.prepare('UPDATE rounds SET state=?,data=? WHERE id=?').run(value.state, JSON.stringify(value), id);
    return value;
  }
  recentRounds() {
    return this.db.prepare('SELECT data FROM rounds ORDER BY rowid DESC LIMIT 5').all().map(row => JSON.parse(row.data));
  }
  seen(uid, bvid) { return !!this.db.prepare('SELECT 1 FROM seen_videos WHERE account_uid=? AND bvid=?').get(uid, bvid); }
  markSeen(uid, bvid) {
    if (uid) this.db.prepare('INSERT OR IGNORE INTO seen_videos VALUES(?,?)').run(uid, bvid);
  }
  audioBudget(config, now = Date.now()) {
    const window = this.window(config, now);
    const usage = this.db.prepare('SELECT COUNT(*) AS requests,COALESCE(SUM(seconds),0) AS seconds FROM audio_jobs WHERE at_ms>=? AND at_ms<?')
      .get(window.start, window.end);
    return { ...window, requests: Number(usage.requests), reservedSeconds: Number(usage.seconds),
      requestLimit: config.dailyAudioRequests, secondsLimit: config.dailyAudioSeconds };
  }
  audioJob(id) {
    const row = this.db.prepare('SELECT data FROM audio_jobs WHERE id=?').get(id);
    return row ? JSON.parse(row.data) : null;
  }
  reserveAudio(id, duration, now = Date.now()) {
    return this.transaction(() => {
      if (this.audioJob(id)) throw new PluginError('AUDIO_ALREADY_ADMITTED', '本次音频已占用额度，不会重复调用。', 409);
      const config = this.config(), budget = this.audioBudget(config, now);
      const seconds = Math.min(Math.ceil(duration), config.asrMaxSeconds, budget.secondsLimit - budget.reservedSeconds);
      if (!Number.isFinite(seconds) || seconds <= 0 || budget.requests >= budget.requestLimit)
        throw new PluginError('AUDIO_LIMIT', '音频处理额度已用完或设为0；未发起转写。', 409);
      this.window(config, now, true);
      const job = { id, seconds, state: 'reserved', at: new Date(now).toISOString() };
      this.db.prepare('INSERT INTO audio_jobs VALUES(?,?,?,?,?)').run(id, now, seconds, job.state, JSON.stringify(job));
      return job;
    });
  }
  finishAudio(id, patch) {
    const before = this.audioJob(id);
    if (!before) throw new PluginError('AUDIO_JOB_MISSING', '音频任务不存在。');
    const job = { ...before, ...patch, id };
    this.db.prepare('UPDATE audio_jobs SET state=?,data=? WHERE id=?').run(job.state, JSON.stringify(job), id);
    return job;
  }
  close() { this.db.close(); }
}
