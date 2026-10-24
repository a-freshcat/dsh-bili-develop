import { randomUUID } from 'node:crypto';
import { assert, errorView, PluginError } from './errors.mjs';
import { bvidOf, requestIdOf } from './decision.mjs';
import { inActivity, nextActivity } from './time.mjs';
import { tagSelection } from './tags.mjs';

const publicRound = round => round && Object.fromEntries(['id', 'state', 'source', 'keyword', 'createdAt', 'finishedAt',
  'deadline', 'limit', 'analysisIds', 'lastRunId', 'reason', 'error', 'tagFilter', 'tagSearchStats', 'browseMode', 'choiceId', 'selection'].filter(k => round[k] !== undefined).map(k => [k, round[k]]));
const browsingKeys = ['autoEnabled', 'keywords', 'dailyRoundLimit', 'dailyAnalysisLimit', 'videosPerRound',
  'browseTagEnabled', 'browseTags', 'browseTagMatch',
  'browseMode', 'dailyBrowseChoiceLimit',
  'intervalMinutes', 'roundTimeoutMinutes', 'timeZone', 'activityStart', 'activityEnd'];

export class Scheduler {
  constructor(controller, now = Date.now) { this.controller = controller; this.store = controller.store; this.now = now; }
  get paused() { return this.store.get('browsingPaused', false); }
  status() {
    const config = this.store.config(), now = this.now();
    const due = this.store.get('nextRunAt', now);
    const budget = this.store.budget(config, now);
    const choiceBudget = this.controller.discovery?.budget();
    const choiceExhausted = config.browseMode === 'autonomous' && choiceBudget?.calls >= choiceBudget?.limit;
    const exhausted = budget.analyses >= budget.analysisLimit || budget.rounds >= budget.roundLimit || choiceExhausted;
    const enabled = config.autoEnabled && !this.paused && config.dailyRoundLimit > 0 && config.dailyAnalysisLimit > 0;
    const next = enabled ? nextActivity(Math.max(now, due, exhausted ? budget.end : 0), config) : null;
    const activity = `活动时段 ${config.activityStart}～${config.activityEnd}（${config.timeZone}）`;
    let code, message;
    if (!config.autoEnabled) { code = 'off'; message = '自动浏览已关闭。'; }
    else if (this.paused) { code = 'paused'; message = '浏览已暂停，继续后仍遵守时段和额度。'; }
    else if (!config.dailyRoundLimit || !config.dailyAnalysisLimit) { code = 'disabled_budget'; message = '浏览轮次或分析上限为0，自动浏览不运行。'; }
    else if (choiceExhausted) { code = 'quota'; message = '本统计日自主选片调用已达 ' + choiceBudget.calls + '/' + choiceBudget.limit + '（0关闭）。' +
      (this.store.openRound() ? '本轮已提交的选片继续等待或执行；新轮次等待额度更新。' : '新轮次等待额度更新。'); }
    else if (exhausted) { code = 'quota'; message = '本统计日额度已用完：轮次 ' + budget.rounds + '/' + budget.roundLimit +
      '，分析 ' + budget.analyses + '/' + budget.analysisLimit + '；等待额度更新及下一个活动窗口。'; }
    else if (!inActivity(now, config)) { code = 'activity'; message = '当前不在' + activity + '，等待下一个活动窗口。'; }
    else if (!inActivity(Math.max(now, due), config)) { code = 'activity'; message = '轮次间隔结束时已超出' + activity + '，等待下一个活动窗口。'; }
    else if (due > now) { code = 'interval'; message = '等待本轮次间隔结束；保存无关设置不会重新计时。'; }
    else if (this.store.active() || this.store.openRound() || this.busy || this.starting || this.controller.metadataBusy || this.controller.social?.busy || this.controller.weekly?.busy || this.controller.installing) {
      code = 'busy'; message = '已到计划时间，等待当前任务结束后检查运行条件。';
    } else { code = 'due'; message = '已到计划时间，后台将在15秒内检查运行条件；DSH需保持运行。'; }
    return { enabled: config.autoEnabled, paused: this.paused, busy: !!this.busy || !!this.starting,
      nextRunAt: next === null ? null : new Date(next).toISOString(),
      schedule: { code, message, now: new Date(now).toISOString(), timeZone: config.timeZone },
      budget, autonomous: { budget: choiceBudget }, round: publicRound(this.store.openRound()),
      recentRounds: this.store.recentRounds().map(publicRound), ...this.store.get('schedulerNotice', {}) };
  }
  notice(reason, error = null) { this.store.set('schedulerNotice', { reason, error }); }
  start() {
    this.timer = setInterval(() => this.kick(), 15000); this.timer.unref?.(); this.kick();
  }
  kick() { if (!this.closed) this.tick().catch(error => { if (!this.closed) this.notice('浏览调度暂未完成。', errorView(error)); }); }
  pause() {
    this.store.set('browsingPaused', true);
    const round = this.store.openRound();
    if (round) this.store.updateRound(round.id, { state: 'paused', reason: '已暂停，当前视频结束后不再启动下一条。' });
    this.notice('已暂停，当前视频结束后不再启动下一条。');
    return { message: '已暂停；当前视频会完成并保存。' };
  }
  resume() {
    this.store.set('browsingPaused', false);
    const round = this.store.openRound();
    if (round?.state === 'paused') this.store.updateRound(round.id, { state: 'waiting', reason: null });
    this.notice('已继续浏览。'); this.kick(); return { message: '已继续浏览，仍受活动时段和额度限制。' };
  }
  configured(before, after) {
    const round = this.store.openRound();
    if (round && (browsingKeys.some(key => JSON.stringify(before[key]) !== JSON.stringify(after[key])) ||
      round.browseMode === 'autonomous' && (before.persona !== after.persona || before.learningEnabled !== after.learningEnabled)))
      this.end(round, 'cancelled', '浏览设置已更新，本轮剩余候选已结束。');
    const due = this.store.get('nextRunAt');
    if ((!before.autoEnabled && after.autoEnabled) || !Number.isFinite(due)) this.store.set('nextRunAt', this.now());
    else if (before.intervalMinutes !== after.intervalMinutes) {
      const last = this.store.recentRounds()[0];
      this.store.set('nextRunAt', last ? Date.parse(last.createdAt) + after.intervalMinutes * 60000 : this.now());
    }
    this.notice('设置已保存。');
  }
  end(round, state, reason, error) {
    this.store.updateRound(round.id, { state, reason, ...(error ? { error } : {}), finishedAt: new Date(this.now()).toISOString() });
    this.notice(reason, error || null);
  }
  async begin(id, source) {
    requestIdOf(id);
    assert(id.length <= 80, 'INVALID_REQUEST_ID', '轮次请求标识过长。');
    const previous = this.store.round(id);
    if (previous) return { round: publicRound(previous), fresh: false };
    const c = this.controller, config = this.store.config(), now = this.now();
    c.assertNotInstalling();
    assert(!this.paused, 'BROWSING_PAUSED', '浏览已暂停，请先继续浏览。', 409);
    assert(!this.store.active() && !this.store.openRound(), 'RUN_BUSY', '已有浏览任务，请等待当前任务。', 409);
    const autonomous = config.browseMode === 'autonomous', queries = config.browseTagEnabled ? config.browseTags : config.keywords;
    assert(autonomous || queries.length, 'NO_KEYWORDS', '请选择自主选片，或填写关键词/实际TAG并保存。');
    assert(!autonomous || this.controller.discovery.budget().calls < config.dailyBrowseChoiceLimit, 'DISCOVERY_LIMIT', '自主选片每日调用已达上限（0关闭），未启动新轮次。');
    const budget = this.store.budget(config, now);
    assert(budget.analyses < budget.analysisLimit, 'ANALYSIS_LIMIT', '已达到当天视频分析上限。', 409);
    assert(budget.rounds < budget.roundLimit, 'ROUND_LIMIT', '已达到当天浏览轮次上限（0表示关闭）。', 409);
    const binding = await c.host.requireBinding();
    assert(!binding.running, 'SESSION_BUSY', '原汇总对话正在运行，请等待空闲。', 409);
    assert(!this.closed && !this.paused, 'BROWSING_PAUSED', '浏览已暂停。', 409);
    const cursor = this.store.get('keywordCursor', 0), keyword = autonomous ? '自主选片' : queries[cursor % queries.length];
    const tagFilter = !autonomous && config.browseTagEnabled ? { tags: [...config.browseTags], match: config.browseTagMatch } : null;
    const searchKey = tagFilter ? 'tag:' + tagFilter.match + ':' + keyword : keyword;
    const round = { id, source, state: 'queued', keyword, keywordCursor: cursor, browseMode: autonomous ? 'autonomous' : 'search',
      searchKey, ...(tagFilter ? { tagFilter } : {}), page: this.store.get('searchPages', {})[searchKey] || 1, cursor: 0, analysisIds: [],
      limit: config.videosPerRound, createdAt: new Date(now).toISOString(),
      deadline: now + config.roundTimeoutMinutes * 60000, sessionId: binding.sessionId };
    const reserved = this.store.reserveRound(round, config, now);
    this.notice('本轮已排队。');
    return { round: publicRound(reserved.round), fresh: reserved.fresh, message: autonomous ? '本轮已提交，将在原对话按人设挑选推荐视频，随后按原评论设置处理。' : '本轮已提交，按原评论设置处理。' };
  }
  async runNow(id) {
    assert(!this.busy && !this.starting, 'RUN_BUSY', '正在处理浏览任务，请稍后再试。', 409);
    this.starting = true;
    try { const result = await this.begin(id, 'immediate'); this.kick(); return result; }
    finally { this.starting = false; }
  }
  async tick() {
    if (this.closed || this.busy) return;
    this.busy = true;
    try {
      const c = this.controller, now = this.now(), config = this.store.config();
      const active = this.store.active();
      if (active) {
        if (active.state === 'awaiting_model' && !c.jobs.has(active.id)) {
          const health = await c.host.health();
          if (!this.closed && !health.running) await c.reconcile(active.id);
        }
        return;
      }
      if (this.paused || c.installing || c.metadataBusy || c.social.busy || c.weekly.busy) return;
      let round = this.store.openRound();
      if (!round) {
        if (!config.autoEnabled) return;
        if (!config.dailyRoundLimit || !config.dailyAnalysisLimit) { this.notice('浏览额度为0，自动浏览已停止。'); return; }
        if (config.browseMode === 'autonomous' && c.discovery.budget().calls >= config.dailyBrowseChoiceLimit) { this.notice('自主选片每日调用已达上限（0关闭），等待下个统计日。'); return; }
        const due = this.store.get('nextRunAt');
        if (!Number.isFinite(due)) this.store.set('nextRunAt', now);
        if ((Number.isFinite(due) && now < due) || !inActivity(now, config)) return;
        const budget = this.store.budget(config, now);
        if (budget.analyses >= budget.analysisLimit || budget.rounds >= budget.roundLimit) { this.notice('今日额度已用完，等待下个统计日。'); return; }
        const health = await c.host.health();
        if (this.closed || health.phase !== 'active' || health.running) { if (!this.closed) this.notice('等待原汇总对话就绪。'); return; }
        round = (await this.begin(randomUUID(), 'scheduled')).round;
        round = this.store.round(round.id);
      }
      if (now >= round.deadline) { this.end(round, 'completed', '本轮已达到时间预算，不再启动新视频。'); return; }
      if (round.source === 'scheduled' && !inActivity(now, config)) { this.notice('等待活动时段，当前轮次已保留。'); return; }
      const budget = this.store.budget(config, now);
      if (budget.analyses >= budget.analysisLimit) { this.end(round, 'completed', '已达到每日分析上限。'); return; }
      if (round.analysisIds.length >= round.limit) { this.end(round, 'completed', '本轮已完成。'); return; }
      const health = await c.host.health();
      if (this.closed || health.phase !== 'active' || health.running) { if (!this.closed) this.notice('等待原汇总对话空闲。'); return; }
      if (!round.candidates) {
        if (round.browseMode === 'autonomous' && !config.dailyBrowseChoiceLimit) { this.end(round, 'completed', '自主选片调用上限为0。'); return; }
        this.store.updateRound(round.id, { state: 'searching' });
        const account = await c.reader().call('account');
        if (this.closed) return;
        assert(account.status === 'logged_in' && account.uid, 'NOT_LOGGED_IN', '请在高级设置中检查登录。');
        if (round.browseMode === 'autonomous') {
          // Keep a paused selection's state intact; an existing request is only reconciled, never resent.
          this.store.updateRound(round.id, { state: this.paused ? 'paused' : 'waiting' });
          await c.discovery.prepare(this.store.round(round.id), String(account.uid)); return;
        }
        const found = await c.reader().call('search_videos', { keyword: round.keyword, page: round.page,
          ...(round.tagFilter ? { tag_filter: round.tagFilter } : {}) }, round.tagFilter ? 120000 : 65000);
        if (this.closed) return;
        assert(Array.isArray(found?.videos) && found.videos.length <= 20, 'SEARCH_RESULT', '搜索返回格式无效。');
        const candidates = [...new Set(found.videos.map(v => bvidOf(v.bvid)))];
        let candidateTags;
        if (round.tagFilter) {
          assert(found.source === 'tag' && found.query === round.keyword && found.accountUid === String(account.uid), 'TAG_RESULT', 'TAG搜索账号或查询条件不匹配；未启动分析。');
          candidateTags = Object.fromEntries(found.videos.map(v => [bvidOf(v.bvid), tagSelection(v, round.tagFilter, round.keyword, this.now())]));
          const stats = found.tagStats;
          assert(stats && ['checked', 'verified', 'matched', 'mismatched', 'unverified'].every(k => Number.isInteger(stats[k]) && stats[k] >= 0 && stats[k] <= 20) &&
            stats.matched === candidates.length && stats.matched + stats.mismatched === stats.verified && stats.verified + stats.unverified === stats.checked,
            'TAG_RESULT', 'TAG核对统计无效；未启动分析。');
        }
        this.store.updateRound(round.id, { candidates, ...(candidateTags ? { candidateTags, tagSearchStats: found.tagStats } : {}), accountUid: String(account.uid),
          state: this.paused ? 'paused' : 'waiting' });
        return;
      }
      // Verify the account each continuation; a changed account must not inherit a pending round.
      const account = await c.reader().call('account');
      if (this.closed || this.paused) return;
      assert(account.status === 'logged_in' && String(account.uid) === round.accountUid,
        'ACCOUNT_CHANGED', '本轮账号已变化或无法验证，请检查登录后重新运行。');
      round = this.store.round(round.id);
      while (round.cursor < round.candidates.length && this.store.seen(round.accountUid, round.candidates[round.cursor])) {
        round = this.store.updateRound(round.id, { cursor: round.cursor + 1 });
      }
      if (round.cursor >= round.candidates.length) { this.end(round, 'completed', round.browseMode === 'autonomous' ? '本轮自主选片已结束；未选或已浏览的视频不启动分析。' : round.tagFilter ? '本页没有满足实际TAG限制的新视频。标签无法核实的候选已跳过，不按标题放行。' : '本页没有新的可分析视频。'); return; }
      this.store.updateRound(round.id, { state: 'waiting' });
      await c.start({ requestId: round.id + '-v' + round.analysisIds.length,
        bvid: round.candidates[round.cursor], roundId: round.id, accountUid: round.accountUid, source: round.source });
    } catch (error) {
      if (!this.closed) {
        const round = this.store.openRound();
        if (this.paused || error?.code === 'ROUND_NOT_READY') return;
        if (['RUN_BUSY', 'SESSION_BUSY', 'INSTALL_BUSY'].includes(error?.code)) { this.notice(error.message); return; }
        if (round) this.end(round, 'failed', '本轮未完成，请查看原因。', errorView(error));
        else this.notice(error instanceof PluginError ? error.message : '浏览调度暂未完成。', errorView(error));
      }
    } finally { this.busy = false; }
  }
  close() { this.closed = true; clearInterval(this.timer); }
}
