import pkg from '../package.json' with { type: 'json' };

export const version = pkg.version;
export async function diagnostics(c) {
  let health;
  try { health = await c.host.health(); } catch { health = { phase: 'unavailable', running: false }; }
  const config = c.store.config(), now = c.now(), active = c.store.active();
  const states = (table, where = '') => Object.fromEntries(c.store.db.prepare('SELECT state,COUNT(*) n FROM ' + table + where + ' GROUP BY state').all().map(r => [r.state, Number(r.n)]));
  const weeklyStates = Object.fromEntries(c.store.db.prepare("SELECT json_extract(data,'$.state') state,COUNT(*) n FROM weekly_drafts GROUP BY json_extract(data,'$.state')").all().map(r => [r.state, Number(r.n)]));
  const sdkVersion = /^\d+\.\d+\.\d+(?:[.a-z0-9-]{0,20})?$/i.test(c.environment?.version || '') ? c.environment.version : 'unchecked';
  const budget = c.store.budget(config, now);
  return { schema: 1, pluginVersion: version, generatedAt: new Date(now).toISOString(), timeZone: config.timeZone,
    binding: { phase: ['active', 'unbound', 'creating', 'repair', 'archived', 'unavailable'].includes(health.phase) ? health.phase : 'unknown', running: health.running === true },
    environment: { reader: c.environment.state, bilibiliApi: sdkVersion, preparing: c.installing === true },
    browsing: { automatic: config.autoEnabled, paused: c.scheduler.paused, mode: config.browseMode,
      choiceBudget: c.discovery.budget(), tagMode: config.browseMode !== 'autonomous' && config.browseTagEnabled,
      roundLimit: config.dailyRoundLimit, analysisLimit: config.dailyAnalysisLimit, usedRounds: budget.rounds, usedAnalyses: budget.analyses },
    queues: { active: active ? { kind: ['video', 'probe', 'interaction', 'dm', 'dm_proactive', 'learning_review', 'weekly', 'browse_choice'].includes(active.kind) ? active.kind : 'unknown',
      state: ['reading', 'awaiting_model', 'saving'].includes(active.state) ? active.state : 'unknown' } : null,
      browsingBusy: c.scheduler.busy === true, socialBusy: c.social.busy === true, commentsBusy: c.comments.busy === true, weeklyBusy: c.weekly.busy === true },
    records: { public: c.store.count(), publicStates: states('runs', " WHERE kind IN ('video','interaction','probe')"), weeklyStates, pendingNoteCleanup: c.store.get('pendingHistoryNotes', []).length },
    modes: { comment: config.commentMode, commentsPaused: c.comments.paused, dmEnabled: config.dmEnabled, dmAutomatic: config.dmAutoSend,
      dmPaused: c.social.paused, learning: config.learningEnabled, dailyReport: config.learningDailyReport,
      weeklyAutomaticDraft: config.weeklyAutoDraft, weeklyAutomaticImage: config.weeklyAutoImage, weeklyAlwaysReviewed: true },
  };
}
