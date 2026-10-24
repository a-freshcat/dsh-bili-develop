import { bvidOf, configOf, requestIdOf, previewPrompt, parsePreview, resultForRequest } from './decision.mjs';
import { PluginError, assert, errorView } from './errors.mjs';
import { writeNote } from './notebook.mjs';
import { ownerContext, uidOf } from './owner.mjs';
import { privatePrompt } from './contacts.mjs';
import { Social } from './social.mjs';
import { Comments } from './comments.mjs';
import { Interactions } from './interactions.mjs';
import { Learning } from './learning.mjs';
import { Weekly } from './weekly.mjs';
import { History } from './history.mjs';
import { diagnostics, version } from './diagnostics.mjs';
import { Scheduler } from './scheduler.mjs';
import { Discovery } from './discovery.mjs';
import { Privacy } from './privacy.mjs';
import { Feedback } from './feedback.mjs';
import { Relationships } from './relationships.mjs';
import { transcribeFallback } from './audio.mjs';
import { coverUrl } from './media.mjs';
import { validateCommentEvidence } from './community.mjs';
import { HISTORY_PAGE_SIZE } from './store.mjs';

const summarizeRun = run => {
  if (!run) return null;
  const { configSnapshot, promptText, evidence, accountUid, dmPayload, proactivePayload, learningSnapshot, learningReview, choicePayload, ...rest } = run;
  return { ...rest, ...(evidence ? { evidence: {
    title: evidence.title, owner: evidence.owner, cover: coverUrl(evidence.cover), source: evidence.source, coverage: evidence.coverage,
    language: evidence.language, readAt: evidence.readAt, totalSegments: evidence.totalSegments,
    processedRanges: evidence.processedRanges, processor: evidence.processor,
    classification: evidence.classification, commentSample: evidence.commentSample, comments: evidence.comments,
    readSegments: evidence.segments?.length || 0,
  } } : {}) };
};

export class Controller {
  constructor({ store, host, reader, resetReader = () => {}, install = async () => {}, installAudio = async () => {},
    downloadModel = async () => { throw new PluginError('MODEL_SETUP_FAILED', '模型准备服务不可用。'); }, modelTimeoutMs = 180000, now = Date.now }) {
    Object.assign(this, { store, host, reader, resetReader, install, installAudio, downloadModel, modelTimeoutMs });
    this.jobs = new Map();
    this.closed = false;
    this.installState = { state: 'idle' };
    this.environment = { state: 'unchecked' };
    this.installing = false;
    this.now = now;
    this.scheduler = new Scheduler(this, now);
    this.social = new Social(this);
    this.comments = new Comments(this);
    this.interactions = new Interactions(this);
    this.learning = new Learning(this);
    this.discovery = new Discovery(this);
    this.weekly = new Weekly(this);
    this.history = new History(this);
    this.privacy = new Privacy(this);
    this.feedback = new Feedback(this);
    this.relationships = new Relationships(this);
  }
  async status({ offset = 0, contactsOffset = 0, contactQuery = '', learningOffset = 0, learningView = {}, weeklyOffset = 0, filters = {} } = {}) {
    assert(Number.isInteger(offset) && offset >= 0 && offset <= 1000000, 'INVALID_PAGE', '分页参数无效。');
    return {
      version, mode: this.store.config().commentMode === 'preview' ? 'preview_only' : 'controlled_comments',
      config: this.store.config(), binding: await this.host.health(),
      ownerProfile: this.store.get('ownerProfile')?.uid === this.store.config().ownerAccountUid ? this.store.get('ownerProfile') : null,
      workspaces: this.host.listWorkspaces(), active: summarizeRun(this.store.active()),
      runs: this.store.list(HISTORY_PAGE_SIZE, offset, filters).map(summarizeRun), total: this.store.count(filters), offset, pageSize: HISTORY_PAGE_SIZE,
      history: this.history.status(filters),
      privacy: this.privacy.context(),
      feedback: this.feedback.status(),
      relationships: this.relationships.status(),
      install: { ...this.installState, ...(this.installing ? {
        elapsedSeconds: Math.max(0, Math.floor((this.now() - Date.parse(this.installState.startedAt)) / 1000)) || 0,
        quietSeconds: Math.max(0, Math.floor((this.now() - Date.parse(this.installState.activityAt || this.installState.startedAt)) / 1000)) || 0,
      } : {}) }, environment: this.environment,
      browsing: this.scheduler.status(),
      audio: { budget: this.store.audioBudget(this.store.config(), this.now()), environment: this.audioEnvironment || { state: 'unchecked' },
        preparedModel: this.preparedModel || null },
      covers: this.coverState || { state: 'idle' },
      social: this.social.status({ contactsOffset, contactQuery }),
      comments: this.comments.status(),
      interactions: this.interactions.status(),
      learning: this.learning.status(learningOffset, learningView),
      weekly: this.weekly.status(weeklyOffset),
    };
  }
  configure(input) {
    this.assertNotInstalling();
    assert(!this.store.active(), 'RUN_BUSY', '请在当前预览结束后再修改设置。', 409);
    assert(!this.scheduler.busy && !this.scheduler.starting, 'RUN_BUSY', '正在准备浏览，请先暂停并等当前操作结束。', 409);
    const config = configOf(input, this.store.config());
    const previous = this.store.config();
    this.store.set('config', config);
    this.social.configured(previous, config);
    this.relationships.configured(previous, config);
    this.comments.configured(previous, config);
    this.interactions.configured(previous, config);
    if (previous.pythonPath !== config.pythonPath) this.resetReader();
    if (previous.pythonPath !== config.pythonPath || previous.asrModelPath !== config.asrModelPath)
      this.audioEnvironment = { state: 'unchecked', message: '设置已变更，请重新检查音频环境。' };
    this.scheduler.configured(previous, config);
    return { config };
  }
  launch(id, operation) {
    const job = Promise.resolve().then(operation).catch(error => {
      if (!this.closed) {
        this.social.failed(this.store.run(id), errorView(error).message);
        this.relationships.failed(this.store.run(id), errorView(error).message);
        this.learning.failed(this.store.run(id), errorView(error).message);
        this.weekly.failed(this.store.run(id), errorView(error).message);
        this.store.update(id, { state: 'failed', error: errorView(error) });
      }
    }).finally(() => this.jobs.delete(id));
    this.jobs.set(id, job);
  }
  async start({ requestId, bvid, kind = 'video', roundId, accountUid, source = 'manual' }) {
    this.assertNotInstalling();
    const id = requestIdOf(requestId);
    assert(kind === 'video' || kind === 'probe', 'INVALID_KIND', '任务类型无效。');
    const normalized = kind === 'video' ? bvidOf(bvid) : '';
    const binding = await this.host.requireBinding();
    this.assertNotInstalling();
    assert(!this.closed, 'PLUGIN_CLOSED', '插件已停止，请重新打开设置。', 503);
    if (roundId) assert(!this.scheduler.paused && !this.closed, 'BROWSING_PAUSED', '浏览已暂停。', 409);
    if (roundId && this.store.round(roundId)?.browseMode === 'autonomous') this.discovery.assertCurrent(this.store.round(roundId));
    const reserved = this.store.start({ id, kind, bvid: normalized, sessionId: binding.sessionId,
      roundId, accountUid, source, now: this.now() });
    if (reserved.fresh) {
      if (roundId && this.store.round(roundId)?.candidateTags?.[normalized])
        reserved.run = this.store.update(id, { browseSelection: this.store.round(roundId).candidateTags[normalized] });
      if (roundId && this.store.round(roundId)?.candidateChoices?.[normalized])
        reserved.run = this.store.update(id, { browseSelection: this.store.round(roundId).candidateChoices[normalized] });
      this.launch(id, () => this.execute(reserved.run));
    }
    return { run: summarizeRun(reserved.run), fresh: reserved.fresh };
  }
  async execute(run) {
    if (this.closed) return;
    const config = { ...this.store.config(), ...(run.kind === 'interaction' ? { commentMentionsEnabled: false } : {}) };
    let evidence = run.kind === 'interaction' ? run.evidence : undefined;
    if (run.kind === 'video') {
      evidence = await this.reader().call('read_video', { bvid: run.bvid, max_chars: config.maxContentChars });
      if (this.closed) return;
      assert(evidence && evidence.bvid === run.bvid && typeof evidence.text === 'string',
        'INVALID_EVIDENCE', '读取结果与当前视频不匹配。');
      if (run.roundId) assert(String(evidence.accountUid) === run.accountUid, 'ACCOUNT_CHANGED', '视频读取期间账号已变化，未投递评价模型。');
      evidence.cover = coverUrl(evidence.cover);
      validateCommentEvidence(evidence, run, config);
      this.store.update(run.id, { evidence, accountUid: String(evidence.accountUid || '') });
      if (/^[1-9]\d{0,19}$/.test(String(evidence.accountUid || ''))) this.store.set('learningAccount', String(evidence.accountUid));
      this.store.markSeen(String(evidence.accountUid || ''), run.bvid);
      evidence = await transcribeFallback(this, run, evidence, config);
      if (this.closed) return;
      this.store.update(run.id, { evidence });
      if (evidence.skipReason || !evidence.text.trim()) {
        this.finish(run.id, { state: 'skipped', skipReason: evidence.skipReason || '没有可读字幕。' });
        await this.interactions.inspect(this.store.run(run.id)); return;
      }
    }
    let text = run.kind === 'dm_proactive' ? this.relationships.prompt(run, config) : run.kind === 'browse_choice' ? this.discovery.prompt(run, config) : run.kind === 'weekly' ? this.weekly.prompt(run, config) : run.kind === 'learning_review' ? this.learning.reviewPrompt(run, config) : run.kind === 'interaction' ? this.interactions.prompt(run, config) : run.kind === 'dm' ? privatePrompt(run, config) : run.kind === 'probe' ?
      ownerContext(config) + '\n这是专用对话的只读接入检查。请只回复：BILI_PROBE_OK ' + run.id :
      previewPrompt({ ...run, publicationContext: this.comments.context(String(evidence.accountUid || '')) }, evidence, config);
    if (['video', 'interaction', 'dm', 'dm_proactive'].includes(run.kind)) {
      const learningSnapshot = this.learning.context(String(evidence?.accountUid || run.accountUid || ''), evidence);
      text = learningSnapshot.text + '\n' + this.learning.instruction(run) + '\n' + text;
      run = this.store.update(run.id, { learningSnapshot });
    }
    // Persist before admission. Restart reconciliation never blindly resends.
    text = this.privacy.prepare(run, text);
    run = this.store.update(run.id, { state: 'awaiting_model', evidence, configSnapshot: config, promptText: text });
    const agent = await this.host.prompt(run, text);
    let timer;
    try {
      const completed = await Promise.race([
        agent.whenIdle().then(() => true),
        new Promise(resolve => { timer = setTimeout(() => resolve(false), this.modelTimeoutMs); }),
      ]);
      if (!this.closed) {
        if (completed) await this.reconcile(run.id);
        else this.store.update(run.id, { waitReason: '模型仍在运行或排队；请稍后检查原对话结果。' });
      }
    } finally { clearTimeout(timer); }
  }
  async reconcile(id) {
    const run = this.store.run(requestIdOf(id));
    assert(run, 'RUN_NOT_FOUND', '任务不存在。', 404);
    if (!['awaiting_model', 'saving', 'needs_review'].includes(run.state)) return { run: summarizeRun(run) };
    const { events } = await this.host.observe(run.sessionId);
    const result = resultForRequest(events, run.id);
    if (!result.ended) return { run: summarizeRun(this.store.update(id, {
      waitReason: result.admitted ? '原对话尚未结束本轮。' : '尚未确认原对话已处理此请求；不会自动重复投递。',
    })) };
    if (result.interrupted || (result.endReason && result.endReason !== 'completed')) {
      this.social.failed(run, '模型本轮未正常完成，未采纳草稿。');
      this.relationships.failed(run, '主动问候生成未正常完成，未采纳草稿。');
      this.learning.failed(run, '模型本轮未正常完成，未应用迭代。');
      this.weekly.failed(run, '模型本轮未正常完成，未采纳周草稿。');
      return { run: summarizeRun(this.store.update(id, { state: 'failed', waitReason: null,
        error: { code: 'MODEL_INTERRUPTED', message: '原对话本轮未正常完成，未采纳其中的草稿。请检查原对话。' } })) };
    }
    assert(result.text.trim(), 'MODEL_EMPTY', '本轮没有可用正文，请检查原对话的模型错误或停止原因。');
    if (run.kind === 'browse_choice') {
      try { return { run: summarizeRun(await this.discovery.complete(run, result.text)) }; }
      catch (error) { return { run: summarizeRun(this.store.update(id, { state: 'failed', waitReason: null, error: errorView(error) })) }; }
    }
    if (run.kind === 'weekly') return { run: summarizeRun(await this.weekly.complete(run, result.text)) };
    if (run.kind === 'dm_proactive') {
      try { return { run: summarizeRun(this.relationships.complete(run, result.text)) }; }
      catch (error) { this.relationships.failed(run, errorView(error).message); return { run: summarizeRun(this.store.update(id, { state: 'failed', waitReason: null, error: errorView(error) })) }; }
    }
    if (run.kind === 'learning_review') {
      try { return { run: summarizeRun(this.learning.complete(run, result.text)) }; }
      catch (error) { this.learning.failed(run, errorView(error).message); return { run: summarizeRun(this.store.update(id, { state: 'failed', waitReason: null, error: errorView(error) })) }; }
    }
    if (run.kind === 'dm') {
      try { return { run: summarizeRun(this.social.complete(run, result.text)) }; }
      catch (error) {
        this.social.failed(run, errorView(error).message);
        return { run: summarizeRun(this.store.update(id, { state: 'failed', error: errorView(error) })) };
      }
    }
    if (run.kind === 'probe') {
      assert(result.text.includes('BILI_PROBE_OK ' + run.id), 'PROBE_FAILED', '模型没有返回本次接入检查标记。');
      return { run: summarizeRun(this.finish(id, { state: 'completed', probeResult: result.text, sessionSeq: result.seq })) };
    }
    let preview;
    try {
      preview = parsePreview(result.text, run, run.evidence, run.configSnapshot);
      this.privacy.check([preview.summary, preview.evaluation, preview.comment, preview.reason].join('\n'), { session: run.sessionId });
      this.learning.checkOutput(preview.comment, run.accountUid);
    } catch (error) { return { run: summarizeRun(this.store.update(id, { state: 'failed', waitReason: null, error: errorView(error) })) }; }
    this.finish(id, { state: 'preview', preview, sessionSeq: result.seq });
    try { this.learning.observe(this.store.run(id), result.text); }
    catch (error) { this.store.update(id, { learningNotice: errorView(error).message }); }
    if (preview.should_comment) {
      try { this.comments.stage(id, preview.mention_uids, true); }
      catch (error) { this.store.update(id, { commentNotice: errorView(error).message }); }
    }
    if (run.kind === 'video') await this.interactions.inspect(this.store.run(id));
    return { run: summarizeRun(this.store.run(id)) };
  }
  finish(id, result) {
    let run = this.store.update(id, { ...result, waitReason: null, noteStatus: 'pending' });
    try {
      const binding = this.store.get('binding');
      assert(binding?.sessionId === run.sessionId, 'BINDING_MISMATCH', '笔记所属对话与绑定不一致。');
      const notePath = writeNote(binding.path, run);
      run = this.store.update(id, { notePath, noteStatus: 'saved' });
    } catch {
      run = this.store.update(id, { noteStatus: 'failed', noteError: '数据库记录已保留，工作区笔记暂未写入；可重试写笔记。' });
    }
    return run;
  }
  retryNote(id) {
    const run = this.store.run(requestIdOf(id));
    assert(run && ['preview', 'completed', 'skipped'].includes(run.state), 'NOTE_NOT_READY', '没有已完成的笔记可重试。');
    return { run: summarizeRun(this.finish(id, {})) };
  }
  async release(id) {
    const run = this.store.run(requestIdOf(id));
    assert(run && run.state === 'awaiting_model', 'RUN_NOT_WAITING', '当前没有等待确认的任务。');
    const health = await this.host.health();
    assert(!health.running, 'SESSION_BUSY', '请先在原对话中停止或等待当前运行结束。', 409);
    return { run: summarizeRun(this.store.update(id, {
      state: 'needs_review', waitReason: '用户已解除本地等待；原对话结果可继续核对，系统不重复投递。',
    })) };
  }
  async recover() {
    const run = this.store.active();
    if (!run) return;
    if (run.state === 'reading') {
      this.social.failed(run, '上次私信评价在重启前中断；不会自动重复调用。');
      this.relationships.failed(run, '上次主动问候生成中断，不重复调用。');
      this.learning.failed(run, '上次日终复盘中断，保留旧迭代，不重复投递。');
      this.weekly.failed(run, '上次周草稿生成中断，不重复投递。');
      if (this.store.audioJob(run.id)?.state === 'reserved')
        this.store.finishAudio(run.id, { state: 'interrupted', message: '上次音频结果未确认；保留占额，不自动重试。' });
      this.store.update(run.id, { state: 'interrupted', error: {
        code: run.kind === 'browse_choice' ? 'INTERRUPTED_CHOICE' : 'INTERRUPTED_READ',
        message: run.kind === 'browse_choice' ? '上次自主选片在重启前中断，本轮不重复投递；选片次数保留。' : '上次读取在重启前中断，未重复执行。可手动创建一次新预览。',
      } });
    } else {
      try { await this.reconcile(run.id); }
      catch { this.store.update(run.id, { waitReason: '原任务需要核对；未创建新对话或重复投递。' }); }
    }
  }
  assertNotInstalling() {
    assert(!this.weekly?.busy, 'RUN_BUSY', '正在处理周动态，请等待完成。', 409);
    assert(!this.social.busy, 'RUN_BUSY', '正在处理联系人或私信，请等待完成。', 409);
    assert(!this.installing, 'INSTALL_BUSY', '读取环境正在准备，请等准备结束后再扫码或读取。', 409);
    assert(!this.metadataBusy, 'RUN_BUSY', this.metadataBusyMessage || '正在补全封面，请等当前操作完成。', 409);
  }
  async lookupOwner(value) { return this.lookupProfile(value, true); }
  async lookupProfile(value, cacheOwner = false) {
    const uid = uidOf(value);
    this.assertNotInstalling();
    assert(!this.store.active() && !this.scheduler.busy && !this.scheduler.starting && !this.store.openRound(),
      'RUN_BUSY', '请在当前浏览或私信任务结束后查询账号。', 409);
    this.metadataBusy = true; this.metadataBusyMessage = '正在查询使用者账号，请等查询结束。';
    try {
      const info = await this.reader().call('user_info', { uid }, 25000);
      assert(!this.closed, 'PLUGIN_CLOSED', '插件已停止。', 503);
      assert(info?.uid === uid && typeof info.name === 'string' && info.name.trim() && info.name.length <= 80 &&
        !/[\r\n\0]/.test(info.name), 'OWNER_PROFILE', '平台没有返回匹配UID的有效昵称，请检查账号后重试。');
      const profile = { uid, name: info.name, face: coverUrl(info.face), profile: 'https://space.bilibili.com/' + uid,
        checkedAt: new Date(this.now()).toISOString() };
      if (cacheOwner) this.store.set('ownerProfile', profile);
      return profile;
    } finally { this.metadataBusy = false; this.metadataBusyMessage = ''; }
  }
  async addMention(value) {
    const p = await this.lookupProfile(value);
    assert(!/[\s@＠\0]/u.test(p.name), 'MENTION_NAME', '该账号昵称含无法安全提及的字符，未加入列表。');
    const targets = this.store.config().mentionTargets, previous = targets.find(t => t.uid === p.uid);
    const target = { uid: p.uid, name: p.name, enabled: previous?.enabled ?? true, allowComment: previous?.allowComment ?? true, allowDynamic: previous?.allowDynamic ?? false };
    return { ...this.configure({ mentionTargets: [...targets.filter(t => t.uid !== p.uid), target] }), message: '已解析并保存提及对象：' + p.name + '（' + p.uid + '）。' };
  }
  changeMention(input) {
    const uid = uidOf(input.uid), config = this.store.config();
    assert(config.mentionTargets.some(t => t.uid === uid), 'MENTION_TARGET', '提及对象不存在。');
    const targets = input.action === 'remove_mention' ? config.mentionTargets.filter(t => t.uid !== uid) : config.mentionTargets.map(t => t.uid === uid ?
      { ...t, enabled: input.enabled, allowComment: input.allowComment, allowDynamic: input.allowDynamic ?? t.allowDynamic } : t);
    return { ...this.configure({ mentionTargets: targets }), message: '提及对象设置已保存。' };
  }
  async checkReader() {
    const result = await this.reader().call('ping', {}, 10000);
    assert(result?.protocol === 1 && typeof result.bilibiliApi === 'string',
      'READER_PROTOCOL', '读取进程返回了不支持的协议。');
    this.environment = { state: 'ready', version: result.bilibiliApi };
    return result;
  }
  preparePython() {
    assert(!this.social.busy, 'RUN_BUSY', '请等待当前私信或联系人操作结束。', 409);
    assert(!this.metadataBusy, 'RUN_BUSY', '正在补全封面，请稍候。', 409);
    assert(!this.store.active(), 'RUN_BUSY', '请在预览结束后准备读取环境。', 409);
    assert(!this.scheduler.busy && !this.store.openRound(), 'RUN_BUSY', '请在浏览轮次结束后准备读取环境。', 409);
    if (this.installing) return this.installState;
    this.installing = true;
    this.installAbort = new AbortController();
    this.installState = { state: 'installing', stage: 'checking', startedAt: new Date().toISOString() };
    this.installJob = Promise.resolve().then(async () => {
      try {
        let available = false;
        try { await this.checkReader(); available = true; } catch { /* install only when needed */ }
        if (this.closed) return;
        if (!available) {
          this.resetReader();
          await this.install({
            signal: this.installAbort.signal,
            onProgress: stage => {
              if (!this.closed) this.installState = { ...this.installState, stage };
            },
          });
          if (this.closed) return;
          this.installState = { ...this.installState, stage: 'verifying' };
          this.resetReader(); await this.checkReader();
        }
        if (!this.closed) this.installState = { state: 'ready', stage: 'complete',
          version: this.environment.version, message: available ? '读取环境已就绪，无需重复安装。' : '依赖准备和运行检查已完成。' };
      } catch (error) {
        if (!this.closed) {
          this.installState = { state: 'failed', error: errorView(error) };
          this.environment = { state: 'failed', error: errorView(error) };
        }
      } finally { this.installing = false; }
    });
    return this.installState;
  }
  async ensureAudioDependencies() {
    const checkActive = () => assert(!this.closed && !this.installAbort.signal.aborted, 'INSTALL_CANCELLED', '准备已停止。');
    const progress = value => {
      if (this.closed || this.installAbort.signal.aborted) return;
      this.installState = { ...this.installState, ...Object.fromEntries(
        ['stage', 'packageName', 'downloadedBytes', 'totalBytes', 'activityAt'].filter(key => key in value).map(key => [key, value[key]])) };
    };
    checkActive(); progress({ stage: 'checking_audio' });
    await this.checkReader();
    checkActive();
    const before = await this.reader().call('audio_check', { model_path: this.store.config().asrModelPath }, 30000);
    checkActive();
    assert(typeof before?.dependencies === 'boolean', 'AUDIO_NOT_READY', '音频环境检查没有返回有效结果，请重试检查。');
    if (!before.dependencies) {
      this.resetReader();
      await this.installAudio({ signal: this.installAbort.signal, onProgress: progress });
      checkActive(); this.resetReader();
    }
  }
  prepareAudio() {
    assert(!this.social.busy, 'RUN_BUSY', '请等待当前私信或联系人操作结束。', 409);
    assert(!this.metadataBusy, 'RUN_BUSY', '正在补全封面，请稍候。', 409);
    assert(!this.store.active() && !this.store.openRound() && !this.scheduler.busy && !this.scheduler.starting,
      'RUN_BUSY', '请在浏览轮次结束后准备音频依赖。', 409);
    if (this.installing) return this.installState;
    this.installing = true;
    this.installAbort = new AbortController();
    this.installState = { state: 'installing', kind: 'audio', stage: 'checking_audio', startedAt: new Date(this.now()).toISOString() };
    this.installJob = Promise.resolve().then(async () => {
      try {
        await this.ensureAudioDependencies();
        if (this.closed) return;
        if (this.installAbort.signal.aborted) throw new PluginError('INSTALL_CANCELLED', '音频依赖准备已停止。');
        this.installState = { ...this.installState, stage: 'verifying_audio', packageName: undefined,
          downloadedBytes: undefined, totalBytes: undefined };
        const result = await this.reader().call('audio_check', { model_path: this.store.config().asrModelPath }, 30000);
        if (this.closed) return;
        if (this.installAbort.signal.aborted) throw new PluginError('INSTALL_CANCELLED', '音频依赖准备已停止。');
        assert(result?.dependencies === true, 'AUDIO_NOT_READY', '音频依赖验证未通过，请检查已有Python解释器。');
        this.audioEnvironment = { state: result.ready ? 'ready' : 'dependencies_ready', ...result };
        this.installState = { state: 'ready', kind: 'audio', version: this.environment.version,
          message: result.ready ? '音频依赖和模型文件已就绪。' : '音频依赖已就绪；讲话模型尚未配置。ASMR评论区概述不需要音频模型。' };
      } catch (error) {
        if (!this.closed) this.installState = this.installAbort.signal.aborted || error?.code === 'INSTALL_CANCELLED' ?
          { state: 'cancelled', kind: 'audio', message: '音频依赖准备已停止，可以重新检查或再次准备。' } :
          { state: 'failed', kind: 'audio', error: errorView(error) };
      } finally { this.installing = false; }
    });
    return this.installState;
  }
  cancelAudio() {
    assert(this.installing && this.installState.kind === 'audio', 'AUDIO_NOT_PREPARING', '当前没有正在准备的音频依赖。');
    const checking = ['checking_audio', 'verifying_audio'].includes(this.installState.stage);
    this.installState = { ...this.installState, stage: 'stopping' };
    this.installAbort.abort();
    if (checking) this.resetReader();
    return { message: '已请求停止音频依赖准备，正在等待进程退出。' };
  }
  prepareModel(model, source) {
    assert(!this.social.busy, 'RUN_BUSY', '请等待当前私信或联系人操作结束。', 409);
    assert(['tiny', 'base', 'small', 'medium'].includes(model) && ['official', 'mirror'].includes(source),
      'MODEL_INPUT', '请选择支持的模型型号和下载源。');
    assert(!this.metadataBusy && !this.store.active() && !this.store.openRound() && !this.scheduler.busy && !this.scheduler.starting,
      'RUN_BUSY', '请在浏览轮次结束后准备模型。', 409);
    if (this.installing) return this.installState;
    this.installing = true;
    this.installAbort = new AbortController();
    this.installState = { state: 'installing', kind: 'model', stage: 'installing_audio', model, source,
      startedAt: new Date().toISOString() };
    this.installJob = Promise.resolve().then(async () => {
      try {
        await this.ensureAudioDependencies();
        if (this.closed || this.installAbort.signal.aborted) throw new PluginError('INSTALL_CANCELLED', '已停止模型准备。');
        const result = await this.downloadModel({ model, source, signal: this.installAbort.signal,
          onProgress: progress => { if (!this.closed) this.installState = { ...this.installState, ...progress }; } });
        if (this.closed || this.installAbort.signal.aborted) throw new PluginError('INSTALL_CANCELLED', '已停止模型准备。');
        assert(result?.model === model && typeof result.path === 'string' && /^[a-f0-9]{40}$/.test(result.revision),
          'MODEL_SETUP_FAILED', '模型准备结果无法确认，原设置已保留。');
        const config = configOf({ asrModelPath: result.path, asrDownloadModel: model, asrDownloadSource: source }, this.store.config());
        this.store.set('config', config);
        this.preparedModel = { path: result.path, model, source, revision: result.revision };
        this.audioEnvironment = { state: 'ready', ready: true, dependencies: true, modelFiles: true,
          message: '模型已完成本机加载验证，可在浏览页按需开启讲话转写。' };
        this.installState = { ...this.installState, state: 'ready', stage: 'complete', modelPath: result.path,
          revision: result.revision, version: this.environment.version,
          message: result.reused ? '已有本地模型已验证，直接复用。' : '模型准备完成，已自动填入模型目录。' };
      } catch (error) {
        if (!this.closed) this.installState = this.installAbort.signal.aborted || error?.code === 'INSTALL_CANCELLED' ?
          { ...this.installState, state: 'cancelled', message: '已停止模型准备，原模型设置保留；再次点击可继续准备。' } :
          { ...this.installState, state: 'failed', error: errorView(error) };
      } finally { this.installing = false; }
    });
    return this.installState;
  }
  cancelModel() {
    assert(this.installing && this.installState.kind === 'model', 'MODEL_NOT_PREPARING', '当前没有正在准备的模型。');
    this.installAbort.abort();
    if (this.installState.stage === 'checking_audio') this.resetReader();
    return { message: '已请求停止模型准备，正在等待子进程退出。' };
  }
  refreshCovers(offset = 0, filters = {}) {
    if (this.metadataBusy && this.coverState?.state === 'running') return this.coverState;
    this.assertNotInstalling();
    assert(Number.isInteger(offset) && offset >= 0 && offset <= 1000000, 'INVALID_PAGE', '分页参数无效。');
    assert(!this.store.active() && !this.scheduler.busy && !this.scheduler.starting && !this.store.openRound(),
      'RUN_BUSY', '请在当前浏览轮次结束后补全封面。', 409);
    const runs = this.store.list(HISTORY_PAGE_SIZE, offset, filters).filter(run => run.kind === 'video' && run.evidence && !coverUrl(run.evidence.cover));
    const videos = [...new Set(runs.map(run => run.bvid))];
    if (!videos.length) return this.coverState = { state: 'completed', message: '当前页没有需要补全的封面。' };
    this.metadataBusy = true;
    this.coverState = { state: 'running', total: videos.length, completed: 0, failed: 0, message: '正在补全当前页封面，不调用评价模型。' };
    this.coverJob = Promise.resolve().then(async () => {
      try {
        for (const bvid of videos) {
          if (this.closed) return;
          try {
            const result = await this.reader().call('read_cover', { bvid });
            if (this.closed) return;
            const cover = coverUrl(result?.cover);
            assert(result?.bvid === bvid && cover, 'COVER_MISSING', '没有获得可用的平台封面。');
            for (const old of runs.filter(run => run.bvid === bvid)) {
              const current = this.store.run(old.id);
              this.store.update(old.id, { evidence: { ...current.evidence, cover } });
            }
            this.coverState = { ...this.coverState, completed: this.coverState.completed + 1 };
          } catch (error) {
            if (this.closed) return;
            this.coverState = { ...this.coverState, failed: this.coverState.failed + 1, error: errorView(error) };
          }
        }
        this.coverState = { ...this.coverState, state: 'completed',
          message: '封面补全结束：成功' + this.coverState.completed + '个视频，未完成' + this.coverState.failed + '个。' };
      } finally { this.metadataBusy = false; }
    });
    return this.coverState;
  }
  async dispatch(input) {
    assert(input && typeof input === 'object' && !Array.isArray(input), 'INVALID_REQUEST', '请求格式无效。');
    if (this.weekly.busy && !['status', 'weekly_preview'].includes(input.action))
      assert(false, 'RUN_BUSY', '正在处理周动态，请等待完成。', 409);
    if (['account', 'login_start', 'login_poll', 'logout', 'reader_ping', 'audio_check', 'audio_cleanup'].includes(input.action))
      assert(this.store.active()?.state !== 'reading' && !this.metadataBusy,
        'RUN_BUSY', '读取进程正在处理内容或补全封面，请等待当前操作结束。', 409);
    switch (input.action) {
      case 'status': return this.status(input);
      case 'diagnostics': return diagnostics(this);
      case 'weekly_generate': return this.weekly.generate();
      case 'weekly_card': return this.weekly.card(input);
      case 'weekly_cleanup': return this.weekly.cleanup(input);
      case 'weekly_project': return this.weekly.project(input);
      case 'weekly_edit': return this.weekly.edit(input);
      case 'weekly_attach_image': case 'weekly_images': return this.weekly.images(input);
      case 'weekly_preview': return this.weekly.preview(input);
      case 'weekly_approve': return this.weekly.approve(input);
      case 'weekly_publish': return this.weekly.publish(input);
      case 'weekly_verify': return this.weekly.verify(input);
      case 'weekly_discard': return this.weekly.discard(input);
      case 'learning_change': return this.learning.change(input);
      case 'learning_rollback': return this.learning.rollbackIteration(input);
      case 'learning_review': return this.learning.review();
      case 'learning_project': this.learning.project(); return { message: this.learning.projection?.state === 'saved' ? '工作区学习快照已更新。' : this.learning.projection?.message || '请先读取视频确认学习账号。' };
      case 'learning_export': return this.learning.archive.export(input);
      case 'feedback_scan': return this.feedback.scan();
      case 'refresh_covers': return this.refreshCovers(input.offset, input.filters);
      case 'configure': return this.configure(input.config);
      case 'lookup_owner': return this.lookupOwner(input.uid);
      case 'add_mention': return this.addMention(input.uid);
      case 'change_mention': case 'remove_mention': return this.changeMention(input);
      case 'prepare_comment': return this.comments.stage(input.requestId, input.mentionUids);
      case 'publish_comment': return this.comments.publish(input.requestId, input.revision, input);
      case 'check_comment': return this.comments.check(input.requestId);
      case 'verify_comment': return this.comments.verify(input.requestId);
      case 'pause_comments': return this.comments.pause();
      case 'resume_comments': return this.comments.resume();
      case 'import_fans': return this.social.importFans(input.page);
      case 'rate_contact': return this.social.rate(input);
      case 'dm_scan': return this.social.scan();
      case 'dm_pause': return this.social.pause();
      case 'dm_resume': return this.social.resume();
      case 'dm_send': return this.social.contacts.message(input.id)?.kind === 'proactive' ? this.relationships.sendManual(input.id, input) : this.social.sendManual(input.id, input);
      case 'dm_forget': return this.social.forget(input.id);
      case 'delete_record': return this.deleteRecord(input.requestId);
      case 'history_preview_delete': return this.history.preview(input.filters);
      case 'history_confirm_delete': return this.history.confirm(input);
      case 'history_retry_notes': return this.history.retryNotes();
      case 'compact_database':
        this.social.assertIdle();
        assert(!this.store.openRound(), 'RUN_BUSY', '请等待当前轮次结束后整理空间。', 409);
        this.store.db.exec('PRAGMA wal_checkpoint(TRUNCATE); VACUUM; PRAGMA wal_checkpoint(TRUNCATE);');
        return { message: '数据库空间已整理；计数与去重记录保留。' };
      case 'bind': return { binding: await this.host.bind(input.workspaceId) };
      case 'analyze': return this.start({ requestId: input.requestId, bvid: input.bvid });
      case 'run_now': return this.scheduler.runNow(requestIdOf(input.requestId));
      case 'pause_browsing': return this.scheduler.pause();
      case 'resume_browsing': return this.scheduler.resume();
      case 'probe': return this.start({ ...input, kind: 'probe' });
      case 'reconcile': return this.reconcile(input.requestId);
      case 'release': return this.release(input.requestId);
      case 'retry_note': return this.retryNote(input.requestId);
      case 'compact':
        assert(!this.social.busy, 'RUN_BUSY', '请等待私信或联系人操作结束。', 409);
        assert(!this.store.active(), 'RUN_BUSY', '请等待当前预览任务完成后再压缩。', 409);
        return this.host.compact();
      case 'account': {
        this.assertNotInstalling(); const value = await this.reader().call('account');
        if (value?.status === 'logged_in') this.social.setAccount(String(value.uid));
        else this.store.set('socialAccount', '');
        this.store.set('learningAccount', value?.status === 'logged_in' ? String(value.uid) : '');
        return value;
      }
      case 'login_start': this.assertNotInstalling(); return this.reader().call('login_start');
      case 'login_poll': this.assertNotInstalling(); return this.reader().call('login_poll');
      case 'logout':
        this.assertNotInstalling();
        assert(!this.store.active(), 'RUN_BUSY', '请等待当前读取结束后再退出账号。', 409);
        this.store.set('socialAccount', ''); this.store.set('learningAccount', ''); return this.reader().call('logout');
      case 'reader_ping': {
        try {
          const result = await this.checkReader();
          if (!this.installing) this.installState = { state: 'ready', version: result.bilibiliApi };
          return { ...result, installing: this.installing };
        } catch (error) {
          this.environment = { state: 'failed', error: errorView(error) };
          if (!this.installing) this.installState = { state: 'failed', error: errorView(error) };
          throw error;
        }
      }
      case 'install_python':
        return this.preparePython();
      case 'install_audio': return this.prepareAudio();
      case 'cancel_audio': return this.cancelAudio();
      case 'prepare_asr_model': return this.prepareModel(input.model, input.source);
      case 'cancel_asr_model': return this.cancelModel();
      case 'audio_cleanup':
        this.assertNotInstalling();
        assert(!this.store.active(), 'RUN_BUSY', '请等待当前任务结束后清理音频缓存。', 409);
        return this.reader().call('audio_cleanup', {}, 10000);
      case 'audio_check': {
        this.assertNotInstalling();
        const result = await this.reader().call('audio_check', { model_path: this.store.config().asrModelPath }, 30000);
        assert(typeof result?.dependencies === 'boolean', 'AUDIO_NOT_READY', '音频环境检查没有返回有效结果，请重试。');
        this.audioEnvironment = { state: result.ready ? 'ready' : result.dependencies ? 'dependencies_ready' : 'unavailable', ...result };
        return result;
      }
      default: throw new PluginError('UNKNOWN_ACTION', '当前版本不支持这个操作。', 404);
    }
  }
  async idle() { await Promise.allSettled([...this.jobs.values()]); }
  deleteRecord(id) {
    return this.history.remove([this.store.run(requestIdOf(id))]);
  }
  close() { this.closed = true; this.scheduler.close(); this.social.close(); this.comments.close(); this.learning.close(); this.weekly.close(); this.feedback.close(); this.relationships.close(); this.installAbort?.abort(); this.resetReader(); }
}
