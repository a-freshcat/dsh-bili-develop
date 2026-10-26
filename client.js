/* Uses the Host's React, settings slot and authenticated transport. No bundle step. */
window.__ModuleLoader__.load({
  id: 'dsh-bili-develop',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const television = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#00a9d6" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m8 3 4 4 4-4"/><rect x="3" y="7" width="18" height="14" rx="3"/><path d="M8 12v4m8-4v4"/></svg>';
    function installNavIcon() {
      // This desktop host chooses unknown section icons internally, with no icon slot.
      const style = document.createElement('style');
      style.textContent = '[data-bili-nav]>svg{display:none!important}[data-bili-nav]::before{content:"";display:block;width:16px;height:16px;flex-shrink:0;background:center/contain no-repeat url("data:image/svg+xml,' + encodeURIComponent(television) + '")}';
      (document.head || document.documentElement).appendChild(style);
      const mark = () => document.querySelectorAll('button[class*="navCell"]').forEach(button => {
        if (button.textContent.trim() === 'B站浏览') button.setAttribute('data-bili-nav', '');
      });
      const observer = new MutationObserver(mark);
      observer.observe(document.documentElement, { childList: true, subtree: true }); mark();
      return () => { observer.disconnect(); style.remove(); document.querySelectorAll('[data-bili-nav]').forEach(button => button.removeAttribute('data-bili-nav')); };
    }
    const css = `
      .bili-harness{max-width:900px;padding:4px 4px 24px;color:inherit;line-height:1.6;font-size:13px}
      .bili-harness *{box-sizing:border-box}
      .bili-harness h2{font-size:20px;margin:0}.bili-harness h3{font-size:16px;font-weight:700;margin:0 0 16px;padding-left:11px;border-left:3px solid #69a6ff;line-height:1.4}
      .bili-harness h4{font-size:14px;font-weight:650;margin:18px 0 10px}
      .bili-harness section{border:0;border-bottom:1px solid #8883;padding:18px 0;margin:0}
      .bili-harness section:last-of-type{border-bottom:0}
      .bili-harness [hidden]{display:none!important}
      .bili-harness .subtabs{display:flex;gap:4px;margin:12px 0 0}.bili-harness .subtabs button{flex:1;padding:6px 3px;font-size:12px}
      .bili-harness .subtabs button[aria-selected=true]{color:#83b6ff;border-color:#438cfa;background:#438cfa16}
      .bili-harness .comment-mode-options{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px;margin:8px 0}
      .bili-harness .comment-mode-options button{padding:8px 4px}
      .bili-harness .comment-mode-options button[aria-checked=true]{color:#9bc7ff;background:#438cfa24;border-color:#438cfa}
      .bili-harness .privacy-mode-options{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin:8px 0}
      .bili-harness .privacy-mode-options button{padding:10px;text-align:left;white-space:normal}
      .bili-harness .privacy-mode-options button[aria-checked=true]{color:#9bc7ff;background:#438cfa24;border-color:#438cfa}
      .bili-harness .setting-group{padding:14px 0;border-bottom:1px solid #8883}
      .bili-harness .setting-group:first-child{padding-top:0}
      .bili-harness .setting-group:last-child{border-bottom:0}
      .bili-harness .setting-group h4{margin:0 0 8px}
      .bili-harness .settings-toolbar{display:flex;justify-content:space-between;align-items:center;gap:8px;margin:14px 0}
      .bili-harness .settings-toolbar h4{margin:0}
      .bili-harness .persona-pane{max-height:58vh;overflow-y:auto;overscroll-behavior:contain;scrollbar-gutter:stable;padding-right:8px;overflow-wrap:anywhere}
      .bili-harness .browse-options{max-height:52vh;overflow-y:auto;overscroll-behavior:contain;scrollbar-gutter:stable;padding-right:8px;overflow-wrap:anywhere}
      .bili-harness .muted{opacity:.7;font-size:13px}.bili-harness .badge{border-radius:20px;background:#6095a322;padding:3px 10px;font-size:12px}
      .bili-harness .row{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:8px 0}
      .bili-harness .head{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px}
      .bili-harness .tabs{display:flex;gap:4px;border-bottom:1px solid #8883;margin-top:16px}
      .bili-harness .tabs button{flex:1;border:0;border-radius:6px 6px 0 0;background:transparent;padding:9px 6px;opacity:.6}
      .bili-harness .tabs button[aria-selected=true]{background:#438cfa12;color:#69a6ff;opacity:1;border-bottom:2px solid #438cfa}
      .bili-harness .save{margin-top:18px;display:flex;justify-content:flex-start}
      .bili-harness button{font:inherit;color:inherit;background:#8881;border:1px solid #8885;border-radius:7px;padding:6px 12px;cursor:pointer}
      .bili-harness button.primary{background:#387fdf;color:white;border-color:#387fdf}
      .bili-harness button:disabled{opacity:.4;cursor:default}
      .bili-harness input,.bili-harness textarea,.bili-harness select{font:inherit;color:inherit;background:#8881;border:1px solid #8885;border-radius:7px;padding:8px;width:100%}
      .bili-harness select{color-scheme:dark}
      .bili-harness select option,.bili-harness select optgroup{color:#f1f1f1;background-color:#303033}
      .bili-harness input[type=checkbox]{width:auto;accent-color:#438cfa}
      .bili-harness label{display:block;margin:12px 0}.bili-harness label span{display:block;font-size:13px;margin-bottom:5px}
      .bili-harness .two{display:grid;grid-template-columns:1fr 1fr;gap:14px}
      .bili-harness .time-part{margin:0;min-width:0}
      .bili-harness .time-part span{font-weight:600;opacity:.85}
      .bili-harness code{overflow-wrap:anywhere;font-size:12px}.bili-harness pre{white-space:pre-wrap;overflow-wrap:anywhere;font:inherit}
      .bili-harness a{color:inherit;text-underline-offset:2px}
      .bili-harness .notice{padding:10px 13px;border-radius:8px;background:#21847818;border:1px solid #21847855;white-space:pre-wrap}
      .bili-harness .error{background:#d25a4918;border-color:#d25a4966}
      .bili-harness details{border:1px solid #8883;border-radius:9px;margin:10px 0;padding:0;min-width:0}
      .bili-harness details[open]{padding-bottom:12px}
      .bili-harness details>:not(summary){margin-left:12px;margin-right:12px}
      .bili-harness summary{cursor:pointer;position:relative;list-style:none;padding:11px 58px 11px 32px;font-size:13px;font-weight:550;line-height:1.55;background:#8880a;border-radius:8px;overflow-wrap:anywhere}
      .bili-harness summary::-webkit-details-marker{display:none}
      .bili-harness summary::before{content:'';position:absolute;left:14px;top:17px;width:6px;height:6px;border-right:1.5px solid currentColor;border-bottom:1.5px solid currentColor;transform:rotate(-45deg);opacity:.65}
      .bili-harness details[open]>summary::before{transform:rotate(45deg);top:15px}
      .bili-harness summary::after{content:'展开';position:absolute;right:12px;top:12px;font-size:11px;font-weight:400;opacity:.6}
      .bili-harness details[open]>summary{border-bottom:1px solid #8882;border-radius:8px 8px 0 0;margin-bottom:10px}
      .bili-harness details[open]>summary::after{content:'收起'}
      .bili-harness details details{border-color:#8882;background:transparent}
      .bili-harness details details>summary{font-size:12px;font-weight:400;background:transparent}
      .bili-harness summary:focus-visible,.bili-harness button:focus-visible{outline:2px solid #69a6ff;outline-offset:3px}
      .bili-harness blockquote{margin:8px 0;padding:8px 14px;border-left:3px solid #218478;background:#8881;white-space:pre-wrap}
      .bili-harness .self-comment{border-left:3px solid #64a8ff;background:#438cfa16}
      .bili-harness .root-comment{border-left:3px solid #58cba5;background:#58cba514}
      .bili-harness .sub-comment{border-left:3px solid #bb95ff;background:#bb95ff16}
      .bili-harness img.qr{width:200px;height:200px;background:white;border-radius:8px;padding:6px}
      .bili-harness .record-top{display:inline-flex;gap:12px;align-items:center;vertical-align:middle;width:calc(100% - 24px)}
      .bili-harness .cover{width:96px;aspect-ratio:16/9;object-fit:cover;border-radius:6px;background:#8882;flex-shrink:0}
      .bili-harness .cover-placeholder{display:inline-flex;align-items:center;justify-content:center;opacity:.6;font-size:12px}
      .bili-harness .record-meta{display:block;margin-top:3px}
      .bili-harness .record-top>span:last-child{min-width:0;overflow-wrap:anywhere}
      .bili-harness .owner-card{border:1px solid #529de177;border-radius:10px;background:#529de110;padding:16px;margin:12px 0}
      .bili-harness .owner-card strong{color:#8ac8ff}.bili-harness .contact-line{display:flex;gap:10px;align-items:center;justify-content:space-between;flex-wrap:wrap}
      .bili-harness .iteration-card{border-left:3px solid #d7ac69;padding:12px;background:#d7ac6910;margin:8px 0;overflow-wrap:anywhere}
      .bili-harness .owner-profile{display:flex;gap:12px;align-items:center;padding:12px;border:1px solid #8883;border-radius:8px;margin:10px 0;overflow-wrap:anywhere}
      .bili-harness .owner-profile img{width:44px;height:44px;border-radius:50%;object-fit:cover;flex-shrink:0}
      .bili-harness .score{font-size:20px;font-weight:600;white-space:nowrap}.bili-harness .private-item{padding:12px 0;border-top:1px solid #8883}
      .bili-harness .people-tabs{margin-bottom:8px}
      .bili-harness .dm-layout{display:grid;grid-template-columns:minmax(165px,.8fr) minmax(0,1.7fr);gap:18px;align-items:start;margin-top:18px}
      .bili-harness .dm-person-list{max-height:56vh;overflow-y:auto;padding:2px 4px 2px 2px}
      .bili-harness .dm-person-list h4{font-size:11px;font-weight:600;letter-spacing:.06em;opacity:.65;margin:12px 4px 6px}
      .bili-harness .dm-person{display:block;width:100%;text-align:left;padding:11px 12px;margin:6px 0;background:transparent;border:1px solid #8883;border-radius:9px;overflow-wrap:anywhere}
      .bili-harness .dm-person[aria-pressed=true]{background:#438cfa14;border-color:#69a6ff}
      .bili-harness .dm-person.owner{border-left:3px solid #69a6ff}
      .bili-harness .dm-person-title{display:flex;gap:7px;align-items:center;flex-wrap:wrap;font-weight:650}
      .bili-harness .dm-person-meta{display:block;font-size:11px;opacity:.7;margin-top:4px}
      .bili-harness .identity-badge{display:inline-block;font-size:10px;line-height:1.7;padding:0 6px;border-radius:4px;color:#91c4ff;background:#438cfa20;border:1px solid #438cfa44;font-weight:600}
      .bili-harness .pending-badge{font-size:11px;color:#e1b871}
      .bili-harness .dm-thread{min-width:0;border:1px solid #8883;border-radius:10px;padding:14px}
      .bili-harness .dm-thread-head{padding-bottom:12px;border-bottom:1px solid #8883;margin-bottom:12px}
      .bili-harness .dm-thread-head h4{font-size:15px;margin:0 0 5px}
      .bili-harness .dm-messages{max-height:54vh;overflow-y:auto;overscroll-behavior:contain;padding-right:5px}
      .bili-harness .dm-message>summary{font-size:12px;font-weight:400;background:transparent}
      .bili-harness .message-label{font-size:11px;font-weight:650;opacity:.7;margin-top:14px;margin-bottom:4px}
      .bili-harness .dm-empty{padding:22px 12px;text-align:center;opacity:.65}
      .bili-harness .interaction-policy{border:1px solid #8883;border-radius:9px;padding:12px 14px;margin:14px 0}
      .bili-harness .interaction-policy h4{margin:0 0 4px}
      .bili-harness .interaction-records{max-height:48vh;overflow-y:auto;overscroll-behavior:contain;padding-right:5px}
      .bili-harness .record-panel{padding-top:8px;min-width:0}
      .bili-harness .record-panel .interaction-records{max-height:none;overflow:visible;padding-right:0}
      .bili-harness .record-card{border:1px solid #8884;border-radius:9px;padding:14px;margin:12px 0;overflow-wrap:anywhere}
      .bili-harness .record-card>.row:first-child{margin-top:0}
      .bili-harness .record-attention{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;padding:10px 12px;margin-top:14px;border:1px solid #d7ac6955;border-radius:8px;background:#d7ac6910}
      .bili-harness .record-focus{border:1px solid #69a6ff77;border-radius:9px;padding:12px;margin-top:14px}
      .bili-harness .record-tabs{margin-bottom:10px}
      .bili-harness .kind-badge{font-size:11px;padding:2px 6px;border-radius:4px;margin-right:6px;background:#58cba518;color:#77d9b5}
      .bili-harness .kind-badge.sub{background:#bb95ff18;color:#c5a6ff}
      @media(max-width:600px){.bili-harness .two{grid-template-columns:1fr}.bili-harness .cover{width:96px}.bili-harness .dm-layout{grid-template-columns:1fr}.bili-harness .dm-person-list{max-height:28vh}.bili-harness .dm-messages{max-height:46vh}}
    `;
    const states = { reading: '读取内容中', awaiting_model: '等待原对话评价', saving: '保存中',
      preview: '预览已生成', skipped: '已跳过', completed: '检查完成', failed: '失败',
      interrupted: '读取中断', needs_review: '待核对' };
    const phases = { unbound: '未绑定', creating: '创建中', active: '已绑定', repair: '需要恢复原绑定', archived: '原对话已归档' };
    const evidenceSources = { subtitle: '平台字幕', asr: '讲话转写', frames: '画面抽帧', comments: '评论区样本', interaction: '关键词命中留言' };
    const commentOrders = { hot: '热评', recent: '最新评论' };
    const learningStates = { candidate: '观察候选', active: '已采用', reduced: '少用', inactive: '已停用', blocked: '用户禁用', archived: '已归档' };
    const learningActions = { observe: '观察表达', draft_use: '草稿使用', archive: '归档', block: '禁用', unblock: '恢复候选',
      reduce: '降低频率', stop: '停用', rollback: '回滚', adopt: '采用', daily_compare: '日终比较' };
    const commentModes = [
      { value: 'preview', label: '仅预览', description: '只生成草稿，不对外发送。' },
      { value: 'manual', label: '逐条确认', description: '在记录中核对最终文案，再逐条确认发表。' },
      { value: 'auto', label: '自动评论', description: '处理启用后新生成的草稿，遵守时段、额度、冷却和暂停。' },
    ];
    const accountStates = { logged_out: '未登录', logged_in: '已登录', expired: '登录已失效', unverified: '登录待验证',
      qrcode_ready: '请用 B站 App 扫码', waiting_scan: '等待扫码', confirming: '请在手机确认',
      qr_expired: '二维码已过期，请重新生成', login_failed: '扫码登录未完成', no_session: '请重新生成二维码' };
    const installStages = { checking: '检查现有环境', creating_env: '创建独立环境',
      installing_packages: '安装依赖', installing_audio: '准备本地转写依赖', checking_model: '检查模型资料',
      checking_audio: '检查现有音频依赖', resolving_packages: '解析音频依赖', downloading_packages: '下载音频依赖',
      installing_audio_packages: '安装音频依赖', verifying_audio: '验证音频依赖', waiting_network: '等待下载连接重试', stopping: '正在停止准备',
      downloading_model: '下载转写模型', verifying_model: '校验文件并试加载模型', verifying: '验证安装结果' };
    const roundStates = { queued: '等待运行', searching: '搜索中', running: '分析中', waiting: '等待下一条',
      paused: '已暂停', completed: '已结束', failed: '未完成', cancelled: '已结束' };
    const loginMessage = value => [accountStates[value.status] || value.status, value.message].filter(Boolean).join(' · ');
    async function api(input, { timeoutMs = input.action === 'status' ? 8000 : 75000 } = {}) {
      const transport = globalThis.__DSH_TRANSPORT__;
      const send = transport?.fetch ? transport.fetch.bind(transport) : globalThis.fetch.bind(globalThis);
      const abort = new AbortController();
      let timer;
      try {
        return await Promise.race([
          (async () => {
            const response = await send('api/bilibili-harness', {
              method: 'POST', credentials: 'same-origin', signal: abort.signal,
              headers: { 'content-type': 'application/json' }, body: JSON.stringify(input),
            });
            let result;
            try { result = await response.json(); } catch { throw new Error('无法连接插件接口（HTTP ' + response.status + '），请检查宿主插件是否已启用。'); }
            if (!response.ok || !result.ok) throw Object.assign(new Error(result.error?.message || '操作未完成。'), { code: result.error?.code });
            return result.value;
          })(),
          new Promise((_resolve, reject) => { timer = setTimeout(() => {
            reject(new Error('请求等待超时，按钮已恢复。请先查看任务状态，再决定是否重试。')); abort.abort();
          }, timeoutMs); }),
        ]);
      } finally { clearTimeout(timer); }
    }
    function Panel({ close, openSession }) {
      const [status, setStatus] = React.useState(null);
      const [config, setConfig] = React.useState(null);
      const [workspace, setWorkspace] = React.useState('');
      const [offset, setOffset] = React.useState(0);
      const [bvid, setBvid] = React.useState('');
      const [busy, setBusy] = React.useState(false);
      const [error, setError] = React.useState('');
      const [message, setMessage] = React.useState('');
      const [account, setAccount] = React.useState(null);
      const [qr, setQr] = React.useState('');
      const [tab, setTab] = React.useState('browse');
      const [feedback, setFeedback] = React.useState({});
      const [busyAction, setBusyAction] = React.useState('');
      const [contactOffset, setContactOffset] = React.useState(0);
      const [contactQuery, setContactQuery] = React.useState('');
      const [rating, setRating] = React.useState(null);
      const [deleting, setDeleting] = React.useState('');
      const [ownerProfile, setOwnerProfile] = React.useState(null);
      const [mentionInput, setMentionInput] = React.useState('');
      const [mentionSelection, setMentionSelection] = React.useState({});
      const [confirmComment, setConfirmComment] = React.useState('');
      const [learningOffset, setLearningOffset] = React.useState(0);
      const [learningConfirm, setLearningConfirm] = React.useState('');
      const [personaView, setPersonaView] = React.useState('base');
      const [weeklyId, setWeeklyId] = React.useState('');
      const [weeklyEdit, setWeeklyEdit] = React.useState(null);
      const [weeklyReviewed, setWeeklyReviewed] = React.useState('');
      const [weeklyImage, setWeeklyImage] = React.useState('');
      const [weeklyOffset, setWeeklyOffset] = React.useState(0);
      const [historyFilters, setHistoryFilters] = React.useState({ q: '', kind: 'video', state: 'all', source: 'all', from: '', to: '' });
      const [historyDelete, setHistoryDelete] = React.useState(null);
      const [diagnostic, setDiagnostic] = React.useState(null);
      const [learningSearch, setLearningSearch] = React.useState({ q: '', state: 'all' });
      const [reviewFilters, setReviewFilters] = React.useState({ reviewFrom: '', reviewTo: '', reviewState: 'all' });
      const [privacyReviews, setPrivacyReviews] = React.useState({});
      const [peopleView, setPeopleView] = React.useState('messages');
      const [privateSearch, setPrivateSearch] = React.useState('');
      const [interactionPane, setInteractionPane] = React.useState('settings');
      const [interactionSettingsPane, setInteractionSettingsPane] = React.useState('send');
      const [publishedSearch, setPublishedSearch] = React.useState('');
      const [recordPane, setRecordPane] = React.useState('browse');
      const mounted = React.useRef(false);
      const working = React.useRef(false);
      const page = React.useRef(0);
      const contactPage = React.useRef({ offset: 0, query: '' });
      const initialized = React.useRef(false);
      const loginGeneration = React.useRef(0);
      const checkingLogin = React.useRef(false);
      const appliedModel = React.useRef('');
      const learningPage = React.useRef(0);
      const weeklyPage = React.useRef(0);
      const historyQuery = React.useRef({ kind: 'video' });
      const learningQuery = React.useRef({});
      const privateQuery = React.useRef({});
      const interactionQuery = React.useRef({});
      const publishedQuery = React.useRef({});
      const pendingQuery = React.useRef({ filter: 'manual', offset: 0 });
      const focusedRecord = React.useRef('');
      const focusedPrivate = React.useRef('');
      const feedbackArea = action => ['bind', 'probe', 'compact'].includes(action) ? 'binding' :
        action.startsWith('weekly_') ? 'weekly' :
        action.startsWith('learning_') ? 'learning' :
        ['feedback_scan', 'feedback_private_scan'].includes(action) ? 'learning' :
        action.startsWith('history_') || action === 'delete_record' ? 'history' :
        ['reader_ping', 'install_python'].includes(action) ? 'reader' :
        ['audio_check', 'install_audio', 'cancel_audio', 'audio_cleanup', 'prepare_asr_model', 'cancel_asr_model'].includes(action) ? 'audio' :
        ['vision_check', 'vision_cleanup'].includes(action) ? 'frames' :
        action === 'refresh_covers' ? 'covers' :
        action === 'lookup_owner' ? 'owner' :
        ['self_replies_scan', 'owner_mentions_scan', 'add_mention', 'change_mention', 'remove_mention', 'prepare_comment', 'publish_comment', 'check_comment', 'verify_comment', 'pause_comments', 'resume_comments'].includes(action) ? 'comments' :
        ['import_fans', 'rate_contact', 'dm_scan', 'dm_pause', 'dm_resume', 'dm_send', 'dm_forget'].includes(action) ? 'social' :
        ['account', 'login_start', 'login_poll', 'logout'].includes(action) ? 'login' :
        ['run_now', 'pause_browsing', 'resume_browsing'].includes(action) ? 'browsing' :
        action === 'analyze' ? 'video' : 'settings';
      const notify = (area, kind, text, recovery = {}) => setFeedback(before => ({ ...before, [area]: { kind, text, ...recovery } }));
      const accountDone = value => {
        setAccount(value);
        if (value.image) { loginGeneration.current++; setQr(value.image); }
        else if (['logged_in', 'expired', 'unverified', 'qr_expired', 'login_failed', 'no_session'].includes(value.status)) {
          loginGeneration.current++; setQr('');
        }
      };
      async function refresh() {
        const requestedLearning = learningQuery.current;
        const requestedPrivate = privateQuery.current;
        const requestedInteractions = interactionQuery.current;
        const requestedPublished = publishedQuery.current;
        const requestedPending = pendingQuery.current, requestedRecord = focusedRecord.current, requestedHistory = historyQuery.current;
        const value = await api({ action: 'status', offset: page.current, contactsOffset: contactPage.current.offset, contactQuery: contactPage.current.query, learningOffset: learningPage.current,
          weeklyOffset: weeklyPage.current, filters: requestedHistory, recordId: requestedRecord, pendingView: requestedPending,
          learningView: requestedLearning, privateView: requestedPrivate, interactionView: requestedInteractions, publishedView: requestedPublished });
        if (!mounted.current || requestedLearning !== learningQuery.current || requestedPrivate !== privateQuery.current || requestedInteractions !== interactionQuery.current || requestedPublished !== publishedQuery.current ||
          requestedPending !== pendingQuery.current || requestedRecord !== focusedRecord.current || requestedHistory !== historyQuery.current) return;
        setStatus(value);
        if (value.social?.privateView) {
          if (requestedPrivate.account && requestedPrivate.account !== value.social.privateView.account) setPrivateSearch('');
          privateQuery.current = value.social.privateView;
        }
        if (value.interactions?.records) interactionQuery.current = { level: value.interactions.records.level, offset: value.interactions.records.offset };
        if (value.comments?.published) {
          if (requestedPublished.account && requestedPublished.account !== value.comments.published.account) setPublishedSearch('');
          const { account, offset, q } = value.comments.published;
          publishedQuery.current = { account, offset, q };
        }
        if (value.learning?.view) {
          if (requestedLearning.account && requestedLearning.account !== value.learning.view.account) {
            setLearningSearch({ q: '', state: 'all' });
            setReviewFilters({ reviewFrom: '', reviewTo: '', reviewState: 'all' });
          }
          learningQuery.current = value.learning.view;
          learningPage.current = value.learning.offset; setLearningOffset(value.learning.offset);
        }
        const preparedPath = value.audio?.preparedModel?.path ||
          (value.install.kind === 'model' && value.install.state === 'ready' ? value.install.modelPath : null);
        if (preparedPath && value.config.asrModelPath === preparedPath && appliedModel.current !== preparedPath) {
          appliedModel.current = preparedPath;
          setConfig(before => ({ ...before, asrModelPath: value.config.asrModelPath,
            asrDownloadModel: value.config.asrDownloadModel, asrDownloadSource: value.config.asrDownloadSource }));
        }
        if (!initialized.current) {
          initialized.current = true; setConfig(value.config);
          setOwnerProfile(value.ownerProfile || null);
          if (value.binding.phase !== 'active') setTab('advanced');
          setWorkspace(value.binding.workspaceId ||
            value.workspaces.find(w => w.title === 'bilibili_test' || /[\\/]bilibili_test$/i.test(w.path))?.id ||
            value.workspaces[0]?.id || '');
        }
      }
      React.useEffect(() => {
        mounted.current = true;
        let polling = false;
        const poll = async () => {
          if (polling) return;
          polling = true;
          try { await refresh(); } catch (e) { if (mounted.current) setError(e.message); }
          finally { polling = false; }
        };
        poll();
        const timer = setInterval(poll, 3000);
        return () => { mounted.current = false; clearInterval(timer); };
      }, []);
      React.useEffect(() => {
        if (!qr) return;
        let stopped = false, timer;
        const generation = loginGeneration.current;
        const poll = async () => {
          if (stopped || generation !== loginGeneration.current) return;
          if (working.current || checkingLogin.current) { timer = setTimeout(poll, 2000); return; }
          checkingLogin.current = true;
          try {
            const value = await api({ action: 'login_poll' });
            if (!stopped && mounted.current && generation === loginGeneration.current) {
              accountDone(value);
              notify('login', value.status === 'logged_in' ? 'success' : 'pending',
                loginMessage(value));
            }
          } catch (e) {
            if (!stopped && mounted.current) notify('login', 'error', e.message);
          } finally {
            checkingLogin.current = false;
            if (!stopped && generation === loginGeneration.current) timer = setTimeout(poll, 2500);
          }
        };
        timer = setTimeout(poll, 1800);
        return () => { stopped = true; clearTimeout(timer); };
      }, [qr]);
      async function act(action, fields = {}, done) {
        if (action === 'configure') {
          const submitted = { ...fields.config };
          for (const key of ['keywords', 'interactionKeywords', 'privacyBlockedTerms', 'browseTags'])
            if (Object.hasOwn(submitted, key)) submitted[key] = (submitted[key] || []).map(k => k.trim()).filter(Boolean);
          fields = { ...fields, config: submitted };
        }
        const area = feedbackArea(action);
        if (action === 'login_poll' && checkingLogin.current) {
          notify('login', 'pending', '正在自动检查扫码结果，请稍候…'); return;
        }
        if (working.current) return;
        if (['login_start', 'logout'].includes(action)) { loginGeneration.current++; setQr(''); }
        working.current = true; setBusy(true); setBusyAction(action); setError(''); setMessage('');
        if (action === 'lookup_owner') setOwnerProfile(null);
        notify(area, 'pending', '正在处理，请稍候…');
        try {
          const value = await api({ action, ...fields }, action === 'weekly_publish' ? { timeoutMs: 130000 } : {});
          if (!mounted.current) return;
          done?.(value);
          const text = action === 'bind' ? '原绑定已就绪。检查模型接入后，可打开汇总对话查看检查消息。' :
            action === 'probe' ? '检查已提交；完成状态会显示在下方，可打开汇总对话查看。' :
            action === 'reader_ping' ? (value.installing ? '解释器响应正常：' : '读取环境已就绪：') + 'bilibili-api-python ' + value.bilibiliApi + (value.installing ? '；完整准备结果请查看环境状态。' : '') :
            ['account', 'login_start', 'login_poll', 'logout'].includes(action) ? loginMessage(value) :
            action === 'analyze' ? '读取任务已提交，完成后可在“记录”和汇总对话查看。' :
            action === 'lookup_owner' ? '已查询到对应的 B站账号。' :
            action === 'vision_check' ? (value.ready ? '画面抽帧环境已就绪：本机可直接解码，不需要外部 ffmpeg。' : '画面抽帧依赖未就绪：' + (value.message || '请准备 av 与 Pillow。')) :
            value.message || '已完成。';
          notify(area, (action === 'audio_check' && !value.ready && !value.dependencies) || (action === 'vision_check' && !value.ready) ? 'error' : 'success', text);
          // Installation progress comes from status polling, never a sticky "preparing" notice.
          if (action === 'install_python' || action === 'install_audio' || action === 'prepare_asr_model')
            setFeedback(before => ({ ...before, [action === 'install_python' ? 'reader' : 'audio']: null }));
          if (action === 'configure') {
            const saved = Object.fromEntries(Object.keys(fields.config).map(key => [key, value.config[key]]));
            setConfig(before => ({ ...before, ...saved })); setMessage('设置已保存，从下次插件任务生效。');
          }
          if (['add_mention', 'change_mention', 'remove_mention'].includes(action)) {
            setConfig(before => ({ ...before, mentionTargets: value.config.mentionTargets }));
            if (action === 'add_mention') setMentionInput('');
          }
          if (['prepare_comment', 'publish_comment'].includes(action)) {
            setConfirmComment('');
            setMentionSelection(before => { const next = { ...before }; delete next[fields.requestId]; return next; });
          }
          if (action === 'delete_record' || action === 'dm_forget') setDeleting('');
          if (action === 'delete_record' && focusedRecord.current === fields.requestId || action === 'history_confirm_delete') focusedRecord.current = '';
          if (action === 'rate_contact') setRating(null);
          if (action === 'learning_change' || action === 'learning_rollback') setLearningConfirm('');
          if (action.startsWith('weekly_')) {
            if (action === 'weekly_preview') setWeeklyImage(value.image);
            else { setWeeklyReviewed(''); setWeeklyImage(''); setWeeklyEdit(null); }
          }
          if (action === 'compact') setMessage(value.message);
          if (action === 'weekly_generate') { weeklyPage.current = 0; setWeeklyOffset(0); setWeeklyId(''); }
          if (action === 'history_preview_delete') setHistoryDelete(value);
          if (action === 'history_confirm_delete') { setHistoryDelete(null); page.current = 0; setOffset(0); }
          if (action === 'diagnostics') setDiagnostic(value);
          // Updating the list must never hold the action mutex.
          refresh().catch(e => { if (mounted.current) notify(area, 'error', '操作已返回，状态刷新未完成：' + e.message); });
        } catch (e) {
          if (mounted.current) {
            setError(e.message);
            const video = fields.bvid || status?.runs?.find(r => r.id === fields.requestId)?.bvid ||
              status?.comments?.recent?.find(d => d.id === fields.requestId)?.bvid;
            notify(area, 'error', e.message, { code: e.code, bvid: video });
          }
        } finally { working.current = false; if (mounted.current) { setBusy(false); setBusyAction(''); } }
      }
      const goReadVideo = video => {
        setBvid(video); setTab('browse'); setConfirmComment(''); setError('');
        setMessage('已带入原视频，请点击“读取并生成评价”，再检查新的草稿。');
        if (typeof document !== 'undefined') setTimeout(() => {
          const section = document.getElementById('bili-manual-read');
          section?.scrollIntoView?.({ block: 'start', behavior: 'smooth' }); section?.querySelector('input')?.focus();
        }, 0);
      };
      const recoveryLink = (text, video) => video && text?.includes('请重新读取并生成评价') &&
        h('button', { type: 'button', onClick: () => goReadVideo(video) }, '去重新读取');
      const inline = area => feedback[area] && h('p', {
        className: 'notice' + (feedback[area].kind === 'error' ? ' error' : ''), role: 'status',
      }, feedback[area].text, recoveryLink(feedback[area].text, feedback[area].bvid));
      const button = (label, action, fields = {}, disabled = false, primary = false, done) =>
        h('button', { type: 'button', disabled: busy || disabled, className: primary ? 'primary' : '',
          onClick: () => act(action, fields, done) }, busyAction === action ? '处理中…' : label);
      const privacyChecked = key => !!status?.privacy && privacyReviews?.[key] === status.privacy.contextHash;
      const privacyCheckbox = key => h('label', { className: 'row' }, h('input', { type: 'checkbox', checked: privacyChecked(key), disabled: busy,
        onChange: e => setPrivacyReviews(before => ({ ...before, [key]: e.target.checked ? status.privacy.contextHash : '' })) }), '已额外核对本条不含私信、联系方式、使用者身份或其他隐私信息');
      const field = (label, key, type = 'text') => h('label', null, h('span', null, label),
        h('input', { type, value: config?.[key] ?? '', disabled: busy || !!status?.active || !!status?.social?.busy || !!status?.comments?.busy || !!status?.interactions?.busy || status?.install?.state === 'installing',
          onChange: e => { if (key === 'ownerAccountUid') { setOwnerProfile(null); setFeedback(before => ({ ...before, owner: null })); }
            setConfig({ ...config, [key]: type === 'number' ? Number(e.target.value) : e.target.value }); } }));
      const timeField = (label, key, end = false) => {
        const [hour, minute] = (config?.[key] || '00:00').split(':');
        const disabled = busy || !!status?.active || !!status?.social?.busy || !!status?.comments?.busy || !!status?.interactions?.busy || status?.install?.state === 'installing';
        const hours = Array.from({ length: end ? 25 : 24 }, (_, i) => h('option', { key: i, value: String(i).padStart(2, '0') },
          String(i).padStart(2, '0') + '点' + (i === 0 ? '（午夜）' : i === 12 ? '（中午）' : i === 24 ? '（当日结束）' : '')));
        const minutes = Array.from({ length: 60 }, (_, i) => h('option', { key: i, value: String(i).padStart(2, '0') }, String(i).padStart(2, '0') + '分'));
        return h('div', { className: 'time-field' }, h('span', null, label + '（24小时制）'), h('div', { className: 'two' },
          h('label', { className: 'time-part' }, h('span', null, '小时'), h('select', { 'aria-label': label + '小时', value: hour, disabled, onChange: e => setConfig({ ...config,
            [key]: e.target.value + ':' + (e.target.value === '24' ? '00' : minute) }) }, ...hours)),
          h('label', { className: 'time-part' }, h('span', null, '分钟'), h('select', { 'aria-label': label + '分钟', value: minute, disabled: disabled || hour === '24',
            onChange: e => setConfig({ ...config, [key]: hour + ':' + e.target.value }) }, ...minutes))));
      };
      if (!status || !config) return h('div', { className: 'bili-harness' },
        h('style', null, css), h('h2', null, 'B站浏览'), h('p', null, error || '正在读取插件状态…'),
        h('button', { onClick: () => act('status') }, '重试连接'));
      const binding = status.binding;
      const active = status.active;
      const pageSize = status.pageSize || 20;
      const installing = status.install.state === 'installing';
      const browsing = status.browsing;
      const budget = browsing?.budget;
      const dateText = value => value ? new Date(value).toLocaleString(undefined, { timeZone: budget?.zone || status.config.timeZone, hourCycle: 'h23' }) : '—';
      const probe = status.runs.find(run => run.kind === 'probe');
      const social = status.social;
      const comments = status.comments;
      const recentUnconfirmedComments = (comments?.recent || []).filter(d => ['unknown', 'failed', 'sending'].includes(d.state));
      const commentPrivacyRequired = comments?.privacyReviewRequired ?? (!!status.privacy?.sharedPrivateContext && status.config.commentPrivacyMode !== 'content');
      const published = comments?.published;
      const sendingBlocked = busy || !!active || installing || !!social?.busy || !!browsing?.busy || !!comments?.busy || !!status.interactions?.busy || !!status.weekly?.busy;
      const selfReplyBlocked = !status.selfReplies?.enabled ? '尚未开启，点击“开启直接回复检查”后接收新回复。' :
        status.selfReplies?.busy ? '正在检查回复，请稍候。' : sendingBlocked ? '当前任务处理中，完成后可检查。' :
        browsing?.paused ? '浏览已暂停，请先继续浏览。' : comments?.paused ? '评论已暂停，请先继续评论。' :
        browsing?.round ? '请等待当前浏览轮次结束。' : !status.config.interactionSubLimit ? '楼中楼上限为0，请先调整并保存互动次数。' :
        !status.config.dailyInteractionEvaluationLimit ? '每日互动判断上限为0，请先调整并保存互动设置。' : '';
      const ownerAccountReady = !!(status.config.ownerAccountEnabled && status.config.ownerAccountUid);
      const ownerMentionBlocked = !ownerAccountReady ? '需先在“关系”页设置并启用使用者账号，才能接收使用者@。' :
        !status.config.ownerCommentReplyEnabled ? '使用者@回复开关未开启，@ 不会进入判断；可在下方开启。' :
        status.ownerMentions?.busy ? '正在检查@通知，请稍候。' : sendingBlocked ? '当前任务处理中，完成后可检查。' :
        browsing?.paused ? '浏览已暂停，请先继续浏览。' : comments?.paused ? '评论已暂停，请先继续评论。' :
        browsing?.round ? '请等待当前浏览轮次结束。' : !status.config.interactionTopLimit ? '普通留言上限为0，请先调整并保存互动次数。' :
        !status.config.dailyInteractionEvaluationLimit ? '每日互动判断上限为0，请先调整并保存互动设置。' : '';
      const weekly = status.weekly;
      const weeklyDraft = weekly?.drafts?.find(d => d.id === weeklyId) || weekly?.drafts?.[0];
      const weeklyEditable = weeklyDraft && ['draft', 'approved', 'failed'].includes(weeklyDraft.state);
      const weeklyLocal = weeklyEdit?.id === weeklyDraft?.id && weeklyEdit?.revision === weeklyDraft?.revision ? weeklyEdit : null;
      const weeklyBody = weeklyLocal?.body ?? weeklyDraft?.body ?? '';
      const weeklyMentions = weeklyLocal?.mentionUids ?? weeklyDraft?.mentions.map(t => t.uid) ?? [];
      const weeklyDirty = !!weeklyLocal;
      const editWeekly = (body, mentionUids) => { setWeeklyReviewed(''); setWeeklyImage('');
        setWeeklyEdit({ id: weeklyDraft.id, revision: weeklyDraft.revision, body, mentionUids }); };
      const weeklyFields = weeklyDraft ? { id: weeklyDraft.id, revision: weeklyDraft.revision } : {};
      const weeklyStates = { generating: '原对话生成中', draft: '待核对图文', approved: '已审核，等待确认发布', sending: '正在发布', accepted: '平台记录已确认',
        unknown: '结果未知，不重发', not_submitted: '上传未完成，动态未提交', rejected: '平台拒绝，不重发', failed: '生成未完成', discarded: '内容已清除' };
      const commentStates = { draft: '尚未发送', sending: '等待平台回执', sent: '平台已接收', unknown: '结果待核对，不重发', failed: '发送未完成，不重发', cancelled: '已取消' };
      const publication = d => h(React.Fragment, null,
        h('p', { className: 'muted' }, commentStates[d.state] || d.state, ' · 发送账号 UID ', d.accountUid),
        h('strong', null, '大肥鱼 · ', d.state === 'draft' ? d.target ? '回复草稿' : '评论草稿' : commentStates[d.state]),
        h('blockquote', { className: 'self-comment' }, d.text || '本地文案已清理。'),
        d.state === 'sent' && h('p', { className: 'muted' },
          d.publicList?.state === 'found' ? '未登录最新评论样本中找到（' + d.publicList.sampleCount + '条样本）。' :
          d.publicList?.state === 'not_in_sample' ? '当前账号可读，未登录最新评论样本未见（' + d.publicList.sampleCount + '条样本）；公开可见性未确认。' :
          d.publicList?.state === 'unavailable' ? '未登录列表检查暂不可用；公开可见性未确认。' : '已取得平台回执或账号内记录；公开可见性未确认。',
          d.publicList?.checkedAt ? ' 核对时间：' + dateText(d.publicList.checkedAt) : '评论定位页可读也不代表“最新”列表已展示。'),
        d.mentions?.length > 0 && h('p', { className: 'muted' }, '提及：', d.mentions.map(t => t.name + '（UID ' + t.uid + '）').join('、'),
          d.state === 'sent' ? d.mentionState === 'rendered' ? ' · 回执含提及信息，通知是否到达请在B站确认。' : ' · 提及效果待平台确认。' : ''),
        h('p', { className: 'muted' }, d.reason),
        recoveryLink(d.reason, d.bvid),
        d.platformFeedback?.toast && h('p', { className: 'muted' }, '平台原提示：', d.platformFeedback.toast),
        d.platformFeedback && h('details', null, h('summary', null, '平台回执详情'),
          !d.platformFeedback.toast && h('p', { className: 'muted' }, '平台未返回额外文字提示。'),
          d.platformFeedback.needCaptcha !== undefined && h('p', { className: 'muted' }, '验证码要求：', d.platformFeedback.needCaptcha ? '是；结果待核对，不自动操作或重发。' : '否'),
          d.platformFeedback.replyState !== undefined && h('p', { className: 'muted' }, '平台评论状态值：', d.platformFeedback.replyState),
          d.platformFeedback.invisible !== undefined && h('p', { className: 'muted' }, '平台不可见标记：', d.platformFeedback.invisible ? '是' : '否', '；不能单凭此值证明列表可见。'),
          d.platformFeedback.successAction !== undefined && h('p', { className: 'muted' }, '平台操作值：', d.platformFeedback.successAction, '（保留原值，含义未确认）')),
        !d.platformFeedback && ['sent', 'unknown', 'failed'].includes(d.state) && !d.contentCleared &&
          h('p', { className: 'muted' }, '此记录未留存发布回执提示，无法补查当时的审核信息。'),
        d.receiptCandidate && !d.receipt && h('p', { className: 'muted' }, '平台候选评论编号：', d.receiptCandidate, '（待核对，不代表已公开）'),
        d.receipt && h('a', { href: 'https://www.bilibili.com/video/' + d.bvid + '/#reply' + d.receipt, target: '_blank', rel: 'noopener noreferrer' }, '打开评论定位'),
        !d.contentCleared && ['unknown', 'sent'].includes(d.state) && h('div', { className: 'row' },
          button('只读核对最近评论', 'verify_comment', { requestId: d.id }, sendingBlocked), h('span', { className: 'muted' },
            d.target ? '楼中楼核对原线程，不验证公开列表展示。' : '同时核对当前账号与未登录最新样本，最多20条；不重发。')));
      const commentEditor = run => {
        const d = run.commentPublication;
        const chosen = mentionSelection[run.id] ?? d?.mentions?.map(t => t.uid) ?? run.preview.mention_uids ?? [];
        const available = run.kind === 'interaction' ? [] : (status.config.mentionTargets || []).filter(t => t.enabled && t.allowComment);
        const changed = !d || JSON.stringify(chosen) !== JSON.stringify(d.mentions.map(t => t.uid)) ||
          d.mentions.some(old => !status.config.commentMentionsEnabled || !available.some(t => t.uid === old.uid && t.name === old.name));
        const key = d && d.id + ':' + d.revision;
        const targets = [...available, ...chosen.filter(uid => !available.some(t => t.uid === uid))
          .map(uid => ({ uid, name: d?.mentions?.find(t => t.uid === uid)?.name || uid, unavailable: true }))];
        return h('div', null,
          h('strong', null, '最终评论与提及'),
          d ? publication(d) : h('blockquote', null, run.preview.comment),
          run.commentNotice && h('div', { className: 'notice error' }, run.commentNotice, recoveryLink(run.commentNotice, run.bvid)),
          (!d || d.state === 'draft') && h(React.Fragment, null,
            targets.map(t =>
              h('label', { className: 'row', key: t.uid }, h('input', { type: 'checkbox', checked: chosen.includes(t.uid),
                disabled: sendingBlocked || (!status.config.commentMentionsEnabled && !chosen.includes(t.uid)),
                onChange: e => { setConfirmComment(''); setMentionSelection(before => ({ ...before,
                  [run.id]: e.target.checked ? [...chosen, t.uid] : chosen.filter(uid => uid !== t.uid) })); } }),
              '@' + t.name + ' · UID ' + t.uid, t.unavailable ? '（已停用或移除，请取消选择）' : '')),
            changed && h('p', { className: 'muted' }, '提及选择尚未写入最终预览，请先更新预览。'),
            h('div', { className: 'row' },
              button('更新最终预览', 'prepare_comment', { requestId: run.id, mentionUids: chosen }, sendingBlocked),
              button('检查发送对象（只读）', 'check_comment', { requestId: run.id }, sendingBlocked || changed),
              h('button', { disabled: sendingBlocked || changed || comments?.paused || status.config.commentMode === 'preview',
                onClick: () => setConfirmComment(key) }, '发送这条评论')),
            confirmComment === key && !changed && h('div', { className: 'notice' },
              h('p', null, '确认用 UID ', d.accountUid, ' 向 ', d.bvid, d.target ? ' 中UID ' + d.target.uid + ' 的' + (d.target.level === 'sub' ? '楼中楼' : '普通留言') + '（评论ID ' + d.target.id + '）回复' : ' 发表', '上方完整文案', d.mentions.length ? '，并附上列出的提及对象（通知是否送达由B站决定）' : '', '？本次发送计入额度。'),
              commentPrivacyRequired && privacyCheckbox('comment:' + key),
              h('div', { className: 'row' }, button('确认发表', 'publish_comment', { requestId: run.id, revision: d.revision,
                privacyReviewed: privacyChecked('comment:' + key), privacyContext: status.privacy?.contextHash }, sendingBlocked || comments?.paused || status.config.commentMode === 'preview' ||
                !!commentPrivacyRequired && !privacyChecked('comment:' + key), true),
                h('button', { onClick: () => setConfirmComment('') }, '取消')))));
      };
      const shownOwnerProfile = ownerProfile && (ownerProfile.uid === String(config.ownerAccountUid || '').trim() ||
        ownerProfile.input === String(config.ownerAccountUid || '').trim()) ? ownerProfile : null;
      const checkbox = (label, key) => h('label', { className: 'row' }, h('input', { type: 'checkbox', checked: !!config[key],
        disabled: sendingBlocked, onChange: e => setConfig({ ...config, [key]: e.target.checked }) }), label);
      const editRating = person => setRating({ uid: person.uid, score: person.score, evaluation: person.evaluation, blocked: !!person.userBlocked });
      const personBody = person => h(React.Fragment, null,
        h('p', null, person.evaluation), person.quote && h('blockquote', null, person.quote),
        h('p', { className: 'muted' }, person.scoreSource === 'deepseek' ? 'DeepSeek评价' : person.scoreSource === 'user' ? '用户调整' : '初始分数', ' · ', person.eligibility.reason),
        h('a', { href: 'https://space.bilibili.com/' + person.uid, target: '_blank', rel: 'noopener noreferrer' }, 'B站主页'),
        h('div', { className: 'row' }, h('button', { disabled: busy || !!active || !!social.busy || installing, onClick: () => editRating(person) }, '调整评分')));
      const privateView = social?.privateView || {};
      const conversations = social?.conversations;
      const changePrivateView = patch => {
        if (busy) return;
        const next = { ...privateView, ...patch };
        privateQuery.current = next;
        return act('status', { privateView: next });
      };
      const privateStates = { evaluating: '生成中', sending: '发送中', draft: '待确认草稿', sent: '已发送',
        unknown: '结果待核对，不重发', failed: '生成失败', skipped: '已跳过' };
      const interactionRecords = status.interactions?.records;
      const changeInteractionView = patch => {
        if (busy) return;
        const next = { ...interactionQuery.current, ...patch };
        interactionQuery.current = next;
        return act('status', { interactionView: next });
      };
      const privatePerson = person => h('button', { key: person.uid, type: 'button',
        className: 'dm-person' + (person.isOwner ? ' owner' : ''), 'aria-pressed': conversations?.selected?.uid === person.uid,
        disabled: busy, onClick: () => changePrivateView({ uid: person.uid, offset: 0 }) },
        h('span', { className: 'dm-person-title' }, person.name || (person.isOwner ? '使用者' : '联系人'),
          person.isOwner && h('span', { className: 'identity-badge' }, '使用者'),
          person.drafts > 0 && h('span', { className: 'pending-badge' }, person.drafts, '份草稿')),
        h('span', { className: 'dm-person-meta' }, 'UID ', person.uid, ' · ', person.total, '条记录'),
        h('span', { className: 'dm-person-meta' }, person.latestAt ? dateText(person.latestAt) : '尚无私信记录'));
      const privateMessage = m => h('details', { className: 'dm-message', key: m.id, id: 'bili-private-' + m.id, 'data-message-id': m.id,
        ...(focusedPrivate.current === m.id ? { open: true } : {}) },
        h('summary', null, dateText(m.at), ' · ', m.kind === 'proactive' ? '主动问候 · ' : '', privateStates[m.state] || m.state),
        m.text && h(React.Fragment, null, h('p', { className: 'message-label' }, '对方来信'), h('blockquote', { className: 'root-comment' }, m.text)),
        m.inlineEmotes?.length > 0 && h('p', { className: 'muted' }, '表情代码：', m.inlineEmotes.join(' '), '（按文字名称理解，未识别图片）'),
        h('p', { className: 'message-label' }, m.kind === 'proactive' ? '大肥鱼 · 主动问候' : '大肥鱼 · 回复'),
        h('blockquote', { className: 'self-comment' }, m.draft || '无回复草稿。'),
        m.evaluation && h('details', { className: 'dm-evaluation' }, h('summary', null, '评价与判断依据'), h('p', null, m.evaluation)),
        m.reason && h('p', { className: 'muted' }, m.reason),
        m.state === 'draft' && (status.privacy?.privateRecipientCount > 1) && privacyCheckbox('dm:' + m.id),
        m.state === 'draft' && button('发送这条私信草稿', 'dm_send', { id: m.id, privacyReviewed: privacyChecked('dm:' + m.id), privacyContext: status.privacy?.contextHash },
          !(m.kind === 'proactive' ? config.dmProactiveEnabled : social.enabled) || social.paused || !m.eligibility.allowed || !!active || installing || !!social.busy ||
          status.privacy?.privateRecipientCount > 1 && !privacyChecked('dm:' + m.id)),
        !['evaluating', 'sending'].includes(m.state) && (deleting === 'dm:' + m.id ?
          h('div', { className: 'row' }, button('确认清理私信内容', 'dm_forget', { id: m.id }, !!active || installing || !!social.busy),
            h('button', { onClick: () => setDeleting('') }, '保留内容')) :
          h('div', { className: 'row' }, h('button', { disabled: busy || !!active || installing || !!social.busy,
            onClick: () => setDeleting('dm:' + m.id) }, '清理这条私信内容'))));
      const learningView = status.learning?.view || learningQuery.current || {};
      const changeLearningView = (patch, resetExpressions = false) => {
        if (busy) return;
        const next = { ...learningView, ...patch };
        if (next.reviewFrom && next.reviewTo && next.reviewFrom > next.reviewTo) {
          notify('learning', 'error', '开始日期不能晚于结束日期。'); return;
        }
        learningQuery.current = next;
        if (resetExpressions) { learningPage.current = 0; setLearningOffset(0); }
        return act('status', { learningOffset: learningPage.current, learningView: next });
      };
      const rangeText = (offset, size, total) => total ? (offset + 1) + '—' + Math.min(offset + size, total) + ' / ' + total : '暂无记录';
      const renderLearningEvents = () => {
        const p = status.learning.eventPage || { offset: 0, total: status.learning.events.length, pageSize: 10 };
        const snapshot = value => !value ? '尚未建立' : value.traits ? '版本 ' + value.version + '：' + (value.traits.map(t => t.text).join('；') || '无迭代条目') :
          (learningStates[value.state] || value.state || '') + ' · 版本 ' + value.version;
        return h('div', { className: 'learning-events' },
          ...status.learning.events.map(e => h('details', { key: e.id },
            h('summary', null, dateText(e.at), ' · ', learningActions[e.action] || e.action, e.expression ? ' · ' + e.expression : e.entity === 'iteration' ? ' · 迭代人设' : ''),
            h('p', null, e.reason), h('p', { className: 'muted' }, '来源：', e.source === 'user' ? '用户操作' : e.source || '旧记录未注明'),
            e.before !== undefined && h('div', { className: 'two' }, h('p', null, '变更前：', snapshot(e.before)), h('p', null, '变更后：', snapshot(e.after))))),
          h('div', { className: 'row' },
            h('button', { disabled: busy || !p.offset, onClick: () => changeLearningView({ eventOffset: Math.max(0, p.offset - 10) }) }, '上10条变更'),
            h('span', { className: 'muted' }, rangeText(p.offset, 10, p.total)),
            h('button', { disabled: busy || p.offset + 10 >= p.total, onClick: () => changeLearningView({ eventOffset: p.offset + 10 }) }, '下10条变更')));
      };
      const choiceDetails = round => round?.selection && h('details', null,
        h('summary', null, '本轮选片理由 · 从', round.selection.considered, '个推荐中选', round.selection.chosen.length, '条'),
        h('p', null, round.selection.intent),
        h('p', { className: 'muted' }, '仅依据推荐的实际标签与简介选片，不表示已经看过；资料时间：', dateText(round.selection.checkedAt)),
        ...round.selection.chosen.map(v => h('p', { key: v.bvid }, h('a', { href: 'https://www.bilibili.com/video/' + v.bvid, target: '_blank', rel: 'noopener noreferrer' }, v.title),
          ' · ', v.reason, h('span', { className: 'muted record-meta' }, '实际标签：', v.tags.join('、') || '无标签'))));

      const scrollToRecord = id => {
        if (typeof document !== 'undefined') setTimeout(() => document.getElementById(id)?.scrollIntoView?.({ block: 'start', behavior: 'smooth' }), 50);
      };
      const openRecord = async id => {
        focusedRecord.current = id; setTab('history');
        try { await refresh(); scrollToRecord('bili-focused-record'); } catch (e) { setError(e.message); }
      };
      const changePendingView = patch => {
        pendingQuery.current = { ...pendingQuery.current, ...patch }; setRecordPane('pending');
        return refresh().catch(e => setError(e.message));
      };
      const openPrivateRecord = async item => {
        focusedPrivate.current = item.id; setTab('people'); setPeopleView('messages'); setPrivateSearch('');
        privateQuery.current = { account: status.social.accountUid, uid: item.uid, offset: item.messageOffset || 0, peopleOffset: 0, q: '' };
        try { await refresh(); scrollToRecord('bili-private-' + item.id); } catch (e) { setError(e.message); }
      };
      const renderPending = () => {
        const p = status.history?.pending;
        if (!p) return null;
        return h('div', { id: 'bili-history-pending', className: 'record-panel', hidden: recordPane !== 'pending' },
          h('h4', null, '待处理 · ', p.total, ' 条'),
          h('p', { className: 'muted' }, '需人工处理 ', p.manual, ' 条；每条展示原因与文案。进入详情不会发送内容，实际发送仍需遵守当前模式和审核。'),
          h('div', { className: 'row', role: 'group', 'aria-label': '待处理筛选' },
            ...[['manual', '只看需人工处理', p.manual], ['all', '全部待发', p.total], ['comment', '评论', p.comments], ['dm', '私信', p.messages]].map(([id, label, count]) =>
              h('button', { key: id, type: 'button', 'aria-pressed': p.filter === id, disabled: busy, onClick: () => changePendingView({ filter: id, offset: 0 }) }, label, ' ', count))),
          ...(p.items || []).map(item => h('article', { key: item.kind + ':' + item.id, className: 'record-card', 'data-pending-id': item.id },
            h('div', { className: 'row' }, h('span', { className: 'kind-badge' + (item.kind === 'dm' ? ' sub' : '') }, item.kind === 'dm' ? '私信' : '评论'),
              h('strong', null, item.title), item.manual && h('span', { className: 'pending-badge' }, '需人工处理')),
            h('p', { className: 'muted' }, dateText(item.at), ' · ', item.kind === 'dm' ? privateStates[item.state] || item.state : commentStates[item.state] || item.state),
            h('p', { className: item.manual ? 'pending-badge' : 'muted' }, '处理原因：', item.manualReason || item.reason || '等待发送条件'),
            (item.targetText || item.received) && h('div', null, h('span', { className: 'message-label' }, item.kind === 'dm' ? '对方来信' : '原留言'),
              h('blockquote', { className: item.kind === 'dm' ? 'sub-comment' : 'root-comment' }, item.targetText || item.received)),
            h('span', { className: 'message-label' }, '大肥鱼 · 待发文案'), h('blockquote', { className: 'self-comment' }, item.text || '没有可发送草稿，请查看生成失败原因。'),
            h('div', { className: 'row' },
              item.kind === 'comment' ? h('button', { type: 'button', disabled: busy || !item.recordAvailable, onClick: () => openRecord(item.id) }, '查看这条评论并处理') :
                h('button', { type: 'button', disabled: busy, onClick: () => openPrivateRecord(item) }, '定位这条私信并处理'),
              item.url && h('a', { href: item.url, target: '_blank', rel: 'noopener noreferrer' }, item.kind === 'dm' ? '打开对方主页' : '打开视频')),
            item.kind === 'comment' && !item.recordAvailable && h('p', { className: 'muted' }, '原记录已清理，保留的文案不可直接发送。'))),
          !p.items?.length && h('p', { className: 'dm-empty' }, p.filter === 'manual' ? '当前没有需要人工处理的条目；可切换到全部待发。' : '此分类没有待处理条目。'),
          h('div', { className: 'row' },
            h('button', { type: 'button', disabled: busy || !p.offset, onClick: () => changePendingView({ offset: Math.max(0, p.offset - p.pageSize) }) }, '上一页待处理'),
            h('span', { className: 'muted' }, rangeText(p.offset, p.pageSize, p.filteredTotal)),
            h('button', { type: 'button', disabled: busy || p.offset + p.pageSize >= p.filteredTotal, onClick: () => changePendingView({ offset: p.offset + p.pageSize }) }, '下一页待处理')));
      };
      const renderPublished = () => h('div', { id: 'bili-published-comments', className: 'record-panel', hidden: recordPane !== 'published' },
            h('h4', null, '已发评论 · 共 ', published?.total || 0, ' 条'),
            h('p', { className: 'muted' }, '汇总当前账号已确认发送的主动评论、关键词回复与楼中楼接话。平台接收不保证其他账号可见；结果未知的尝试仍在原记录中核对。'),
            h('label', null, h('span', null, '按视频、BV号或评论内容查找'), h('input', { value: publishedSearch, maxLength: 100,
              onChange: e => setPublishedSearch(e.target.value), disabled: busy })),
            h('div', { className: 'row' }, h('button', { disabled: busy, onClick: () => {
              publishedQuery.current = { ...publishedQuery.current, q: publishedSearch, offset: 0 }; return refresh();
            } }, '查找已发评论'), h('button', { disabled: busy, onClick: () => {
              setPublishedSearch(''); publishedQuery.current = { ...publishedQuery.current, q: '', offset: 0 }; return refresh();
            } }, '显示全部已发评论')),
            h('div', { className: 'interaction-records' }, ...(published?.rows || []).map(d => h('article', { key: d.id, className: 'private-item', 'data-published-comment': d.id },
              h('strong', null, d.title || d.bvid), h('p', { className: 'muted' }, d.target ? d.target.level === 'sub' ? '楼中楼接话' : '回复普通留言' : '主动视频评论',
                ' · ', dateText(d.attemptedAt || d.confirmedAt)),
              h('blockquote', { className: 'self-comment' }, d.text || '本地文案已清理。'),
              h('div', { className: 'row' }, h('a', { href: 'https://www.bilibili.com/video/' + d.bvid + '/#reply' + d.receipt, target: '_blank', rel: 'noopener noreferrer' }, '打开已发评论'),
                h('button', { disabled: busy, onClick: () => openRecord(d.id) }, '查看这条评论的记录')))),
              !published?.rows?.length && h('p', { className: 'dm-empty' }, '暂无匹配的已确认发送评论。')),
            published && h('div', { className: 'row' }, h('button', { disabled: busy || !published.offset, onClick: () => {
              publishedQuery.current = { ...publishedQuery.current, offset: Math.max(0, published.offset - published.pageSize) }; return refresh();
            } }, '上一页已发评论'), h('span', { className: 'muted' }, rangeText(published.offset, published.pageSize, published.total)),
              h('button', { disabled: busy || published.offset + published.pageSize >= published.total, onClick: () => {
                publishedQuery.current = { ...publishedQuery.current, offset: published.offset + published.pageSize }; return refresh();
              } }, '下一页已发评论')),
            recentUnconfirmedComments.length > 0 && h('div', { className: 'setting-group' }, h('h4', null, '近期未确认的发送尝试'),
              h('p', { className: 'muted' }, '结果不明或失败的尝试不计入已发评论；可只读核对，绝不自动重发。'),
              ...recentUnconfirmedComments.map(d => h('article', { key: d.id, className: 'private-item' },
                h('strong', null, d.title || d.bvid), h('p', { className: 'muted' }, commentStates[d.state] || d.state, ' · ', dateText(d.attemptedAt)),
                publication(d)))));
      const renderRunDetails = (run, focused = false) => h('details', { key: run.id, id: (focused ? 'bili-focused-' : 'bili-record-') + run.id, ...(focused ? { open: true } : {}) },
            h('summary', null, h('span', { className: 'record-top' },
              run.kind === 'video' && (run.evidence?.cover ? h('img', { className: 'cover', src: run.evidence.cover,
                alt: '视频封面', loading: 'lazy', referrerPolicy: 'no-referrer',
                onError: e => { e.currentTarget.alt = '封面暂不可用'; } }) : h('span', { className: 'cover cover-placeholder' }, '封面暂缺')),
              h('span', null, h('strong', null, run.evidence?.title || run.bvid || '模型接入检查'),
                h('span', { className: 'muted record-meta' }, states[run.state] || run.state, ' · ', dateText(run.createdAt))))),
            ['video', 'interaction'].includes(run.kind) && h('a', { href: 'https://www.bilibili.com/video/' + run.bvid + '/', target: '_blank', rel: 'noopener noreferrer' }, '打开视频'),
            h('p', { className: 'muted' }, dateText(run.createdAt), ' · ', h('code', null, run.id)),
            run.kind === 'video' && h('p', { className: 'muted' }, '来源：',
              ({ manual: '手动读取', immediate: '立即运行', scheduled: '定时浏览', interaction: '评论互动', owner_mention: '使用者@触发' })[run.source || 'manual'],
              run.roundId ? ' · 轮次 ' + run.roundId : ''),
            run.browseSelection?.mode === 'tag' && h('p', { className: 'muted' }, 'TAG入口：', run.browseSelection.query,
              ' · 实际标签：', run.browseSelection.tags.map(t => t.name).join('、'), ' · 核对时间：', dateText(run.browseSelection.checkedAt)),
            run.browseSelection?.mode === 'autonomous' && h('p', { className: 'muted' }, '自主选片：', run.browseSelection.reason,
              ' · 实际标签：', run.browseSelection.tags.join('、') || '无标签', ' · 当时想了解：', run.browseSelection.intent),
            run.evidence && h('p', { className: 'muted' }, '依据：', evidenceSources[run.evidence.source] || run.evidence.source,
              run.evidence.textSource ? '＋' + (evidenceSources[run.evidence.textSource] || run.evidence.textSource) + ' · 文本覆盖：' + run.evidence.textCoverage : '',
              run.evidence.source === 'frames' ? ' · 抽帧：' + run.evidence.totalFrames + ' 帧 · 时间点（秒）：' + (run.evidence.frameTimes || []).join('、') : run.evidence.source === 'interaction' ? (run.interactionTrigger === 'self_reply' ? ' · 对自己评论的直接回复' : run.interactionTrigger === 'owner_mention' ? ' · 使用者@触发的单条留言' : ' · 普通评论关键词命中') : run.evidence.source === 'comments' ? ' · 已读 ' + run.evidence.commentSample.count + ' 条样本，非完整视频理解' :
                ' · 覆盖：' + run.evidence.coverage + ' · 文本段数：' + run.evidence.readSegments + '/' + run.evidence.totalSegments),
            run.visionNotice && h('p', { className: 'notice' }, '画面理解未使用，已回退文本：', run.visionNotice),
            run.interactionTarget && h(React.Fragment, null, h('strong', null, run.interactionTarget.level === 'sub' ? '楼中楼 · 原留言' : '检索普通留言 · 原留言'),
              h('blockquote', { className: run.interactionTarget.level === 'sub' ? 'sub-comment' : 'root-comment' }, run.interactionTarget.text),
              h('p', { className: 'muted' }, 'UID ', run.interactionTarget.uid, ' · 评论 ', run.interactionTarget.id)),
            run.interactionScan && h('details', null, h('summary', null, '评论互动检索结果'), h('p', { className: 'muted' }, run.interactionScan.message),
              ...(run.interactionScan.matches || []).map(row => h('div', { key: row.id }, h('strong', null, row.level === 'sub' ? '楼中楼留言' : '检索普通留言'),
                h('blockquote', { className: row.level === 'sub' ? 'sub-comment' : 'root-comment' }, row.text),
                h('a', { href: row.url, target: '_blank', rel: 'noopener noreferrer' }, '查看原留言')))),
            run.evidence?.source === 'comments' && h(React.Fragment, null,
              h('p', { className: 'muted' }, '未播放或分析音频。已读排序：', run.evidence.commentSample.orders.map(order => commentOrders[order]).join('、') || '无',
                run.evidence.commentSample.failedOrders.length ? '；暂不可读：' + run.evidence.commentSample.failedOrders.map(order => commentOrders[order]).join('、') : ''),
              run.evidence.comments.length > 0 && h('details', null, h('summary', null, '查看已读评论样本'),
                ...run.evidence.comments.map(row => h('div', { key: row.id }, h('strong', null, '检索普通留言'), h('blockquote', { className: 'root-comment' }, row.text),
                  h('a', { href: row.url, target: '_blank', rel: 'noopener noreferrer' }, '查看评论'),
                  h('span', { className: 'muted' }, ' · ', commentOrders[row.order], ' · ', row.likes, '赞', row.truncated ? ' · 已截短' : ''))))),
            run.evidence?.processedRanges && h('p', { className: 'muted' }, run.evidence.source === 'frames' ? '画面处理区间（秒）：' : '音频处理区间（秒）：',
              run.evidence.processedRanges.map(r => r.from + '–' + Number(r.to).toFixed(1)).join('、')),
            run.preview && h(React.Fragment, null,
              h('strong', null, run.evidence?.source === 'comments' ? '评论区概述' : '摘要'), h('p', null, run.preview.summary),
              h('strong', null, '评价'), h('p', null, run.preview.evaluation),
              run.preview.should_comment ? commentEditor(run) : h('p', null, '本次不准备评论。'),
              h('p', null, run.preview.reason), h('p', { className: 'muted' }, run.evidence?.source === 'frames' ? '画面依据：' : '文本依据：', run.preview.evidence_quote)),
            (run.skipReason || run.error?.message || run.waitReason) &&
              h('p', null, run.skipReason || run.error?.message || run.waitReason),
            run.probeResult && h('p', null, run.probeResult),
            h('p', { className: 'muted' }, run.noteStatus === 'saved' ? '工作区笔记：' + run.notePath : run.noteError || ''),
            h('div', { className: 'row' },
              ['preview', 'completed', 'skipped', 'failed', 'interrupted'].includes(run.state) && (deleting === run.id ?
                h(React.Fragment, null, button('确认删除记录与笔记', 'delete_record', { requestId: run.id }, !!active || installing || !!social?.busy),
                  h('button', { onClick: () => setDeleting('') }, '保留记录')) :
                h('button', { disabled: busy || !!active || installing || !!social?.busy, onClick: () => setDeleting(run.id) }, '删除这条记录')),
              run.noteStatus === 'failed' && button('重试写笔记', 'retry_note', { requestId: run.id }),
              run.state === 'needs_review' && button('核对原结果', 'reconcile', { requestId: run.id })));

      return h('div', { className: 'bili-harness' }, h('style', null, css),
        h('div', { className: 'head' }, h('h2', null, 'B站浏览'),
          h('button', { type: 'button', onClick: () => setTab(binding.phase === 'active' ? 'browse' : 'advanced') },
            binding.phase === 'active' ? '读取视频' : '设置绑定')),
        h('div', { className: 'row' },
          h('button', { type: 'button', className: 'badge', onClick: () => { setTab('interaction'); setInteractionPane('settings'); setInteractionSettingsPane('send'); } },
            '发送方式：', ({ preview: '仅预览', manual: '逐条确认', auto: '自动评论' })[status.config.commentMode] || '仅预览', comments?.paused ? ' · 已暂停' : ''),
          h('span', { className: 'badge' }, phases[binding.phase] || binding.phase),
          h('span', { className: 'badge' }, account ? accountStates[account.status] || account.status : '登录待检查'),
          h('span', { className: 'badge' }, '记录 ' + status.total),
          budget && h('span', { className: 'badge' }, '今日分析 ' + budget.analyses + '/' + budget.analysisLimit),
          h('span', { className: 'muted' }, status.version)),
        error && h('p', { className: 'notice error', role: 'alert' }, error),
        message && h('p', { className: 'notice', role: 'status' }, message),
        h('nav', { className: 'tabs', role: 'tablist', 'aria-label': 'B站浏览设置' },
          ...[['browse', '浏览'], ['interaction', '互动'], ['persona', '人设'], ['people', '关系'], ['weekly', '动态'], ['history', '记录'], ['advanced', '高级']].map(([id, label]) =>
            h('button', { key: id, role: 'tab', 'aria-selected': tab === id,
              'aria-controls': 'bili-tab-' + id, onClick: () => setTab(id) }, label))),
        weekly && h('section', { id: 'bili-tab-weekly', hidden: tab !== 'weekly', className: 'persona-pane' },
          h('h3', null, '周总结图文 · 审核后发布'),
          h('p', { className: 'muted' }, '最近7天已读公开素材；沿用原汇总对话。确认发布前不会上传图片，始终需要你审核和确认发布。'),
          button('生成 / 更新本周草稿', 'weekly_generate', {}, sendingBlocked || !!browsing?.round, true),
          inline('weekly'), weekly.notice && h('p', { className: 'muted' }, weekly.notice),
          weeklyDraft && h('div', null,
            h('p', { className: 'badge' }, weeklyStates[weeklyDraft.state] || weeklyDraft.state),
            h('p', { className: 'muted' }, '发送账号 UID ', weeklyDraft.accountUid, ' · 周标识 ', weeklyDraft.weekKey),
            weeklyDraft.reason && h('p', { className: 'notice' }, weeklyDraft.reason),
            h('label', null, h('span', null, '动态正文（最多1800字）'), h('textarea', { rows: 6, maxLength: 1800, value: weeklyBody,
              disabled: sendingBlocked || !weeklyEditable, onChange: e => editWeekly(e.target.value, weeklyMentions) })),
            ...(status.config.mentionTargets || []).filter(t => t.enabled && t.allowDynamic).map(t => h('label', { key: t.uid },
              h('input', { type: 'checkbox', checked: weeklyMentions.includes(t.uid), disabled: sendingBlocked || !weeklyEditable,
                onChange: e => editWeekly(weeklyBody, e.target.checked ? [...weeklyMentions, t.uid] : weeklyMentions.filter(uid => uid !== t.uid)) }),
              ' @' + t.name + ' · UID ' + t.uid)),
            h('p', { className: 'muted' }, '需先用发送账号关注被提及对象；名单与动态权限在“互动 → 提及对象”设置。'),
            weeklyEditable && button('保存文案与提及', 'weekly_edit', { ...weeklyFields, body: weeklyBody, mentionUids: weeklyMentions }, sendingBlocked || !weeklyDirty),
            h('h3', null, '配图 ', weeklyDraft.images.length, '/3'),
            weeklyEditable && button('生成 / 更新周报卡片', 'weekly_card', weeklyFields, sendingBlocked || weeklyDirty),
            weeklyDraft.cardState === 'pending' && h('p', { className: 'muted' }, '本地配图生成中，正文已保存。'),
            weeklyDraft.imageBrief && h('p', { className: 'muted' }, '选图建议：', weeklyDraft.imageBrief),
            h('div', { className: 'row' }, ...weeklyDraft.images.map((image, i) => h('div', { key: image.hash, style: { maxWidth: '180px' } },
              h('img', { src: image.thumbnail, alt: '动态配图' + (i + 1), style: { width: '100%', maxHeight: '160px', objectFit: 'contain' } }),
              h('p', { className: 'muted' }, image.kind === 'card' ? '本地周报卡片 · ' : '', image.width, ' × ', image.height),
              button('查看完整配图', 'weekly_preview', { id: weeklyDraft.id, hash: image.hash }, busy),
              weeklyEditable && button('移除', 'weekly_images', { ...weeklyFields, hashes: weeklyDraft.images.filter(im => im.hash !== image.hash).map(im => im.hash) }, sendingBlocked || weeklyDirty),
              weeklyEditable && i > 0 && button('前移', 'weekly_images', { ...weeklyFields, hashes: (() => { const ids = weeklyDraft.images.map(im => im.hash); [ids[i - 1], ids[i]] = [ids[i], ids[i - 1]]; return ids; })() }, sendingBlocked || weeklyDirty)))),
            weeklyImage && h('div', null, h('img', { src: weeklyImage, alt: '当前处理后的完整配图', style: { maxWidth: '100%', maxHeight: '65vh', objectFit: 'contain' } }),
              h('button', { onClick: () => setWeeklyImage('') }, '收起完整配图')),
            weeklyEditable && weeklyDraft.images.length < 3 && h('label', null, h('span', null, '选择本地PNG/JPEG（每张≤4MB；保存为去除元数据的JPEG，最长边1600像素）'),
              h('input', { type: 'file', accept: 'image/png,image/jpeg', disabled: sendingBlocked || weeklyDirty,
                onChange: async e => {
                  const file = e.target.files?.[0]; e.target.value = ''; if (!file) return;
                  if (file.size > 4 * 1024 * 1024) { notify('weekly', 'error', '请选择4MB以内的图片。'); return; }
                  try {
                    const encoded = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1]); reader.onerror = reject; reader.readAsDataURL(file); });
                    await act('weekly_attach_image', { ...weeklyFields, base64: encoded });
                  } catch { notify('weekly', 'error', '图片读取未完成，请重新选择。'); }
                } })),
            weeklyEditable && h('label', null, h('input', { type: 'checkbox', checked: weeklyReviewed === weeklyDraft.revision, disabled: sendingBlocked || weeklyDirty,
              onChange: e => setWeeklyReviewed(e.target.checked ? weeklyDraft.revision : '') }), ' 我已核对完整文案、配图顺序和提及对象'),
            weeklyEditable && status.privacy?.sharedPrivateContext && privacyCheckbox('weekly:' + weeklyDraft.revision),
            weeklyEditable && button('审核当前图文', 'weekly_approve', { ...weeklyFields, reviewed: true, privacyReviewed: privacyChecked('weekly:' + weeklyDraft.revision),
              privacyContext: status.privacy?.contextHash }, sendingBlocked || weeklyDirty || weeklyDraft.images.length === 0 || weeklyReviewed !== weeklyDraft.revision ||
              !!status.privacy?.sharedPrivateContext && !privacyChecked('weekly:' + weeklyDraft.revision)),
            weeklyDraft.state === 'approved' && button('确认发布这条动态', 'weekly_publish', { ...weeklyFields, confirmed: true }, sendingBlocked || weeklyDirty || weeklyDraft.approval?.revision !== weeklyDraft.revision, true),
            weeklyDraft.receipt && h('p', null, h('a', { href: 'https://t.bilibili.com/' + weeklyDraft.receipt, target: '_blank', rel: 'noreferrer' }, '到B站核对动态')),
            ['unknown', 'accepted'].includes(weeklyDraft.state) && button('只读核对发布结果', 'weekly_verify', { id: weeklyDraft.id }, sendingBlocked || weeklyDirty),
            weeklyDraft.verification && h('p', { className: 'muted' }, '最近核对：', weeklyDraft.verification.checkedAt, ' · ',
              ({ found: '本人动态列表找到唯一匹配，公开展示另行确认', not_in_sample: '样本未见，不能证明没有发布', ambiguous: '发现多个候选，未确认', unavailable: '暂未完成，保留原状态' })[weeklyDraft.verification.status],
              ' · 已读 ', weeklyDraft.verification.sampleCount, ' 条'),
            button('恢复工作区草稿笔记', 'weekly_project', { id: weeklyDraft.id }, sendingBlocked || weeklyDirty),
            h('details', null, h('summary', null, '素材来源（' + weeklyDraft.sources.length + '个视频）'),
              ...weeklyDraft.sources.map(s => h('p', { key: s.id }, h('a', { href: s.url, target: '_blank', rel: 'noreferrer' }, s.title), ' · ', evidenceSources[s.source] || s.source)),
              h('p', { className: 'muted' }, '引用检查只能验证原文依据；正文含义与配图是否合适由你审核。')),
            !['generating', 'sending', 'discarded'].includes(weeklyDraft.state) && h('details', null, h('summary', null, '清除这份草稿'),
              h('p', { className: 'muted' }, '清除正文与草稿引用，并回收未被其他草稿引用的原配图；发布次数和去重记录保留。'),
              button('确认清除草稿内容', 'weekly_discard', weeklyFields, sendingBlocked))),
          h('details', null, h('summary', null, '草稿设置与历史'),
            checkbox('每周自动生成草稿（仍须人工审核和发布）', 'weeklyAutoDraft'),
            checkbox('草稿自动配一张本地周报卡片（无需图片服务）', 'weeklyAutoImage'),
            field('每周第几天生成（1周一，7周日）', 'weeklyDay', 'number'), timeField('草稿生成时间', 'weeklyTime'),
            field('至少有几个不同视频素材', 'weeklyMinSources', 'number'),
            field('每天最多生成草稿次数（0关闭）', 'weeklyDailyDraftLimit', 'number'),
            field('每天最多发布尝试次数（0关闭）', 'weeklyDailyPublishLimit', 'number'),
            field('最短发布间隔（小时）', 'weeklyMinIntervalHours', 'number'),
            button('保存动态设置', 'configure', { config }, sendingBlocked, true),
            h('p', { className: 'muted' }, '当天草稿 ', weekly.budget.generations, '/', weekly.budget.generationLimit, '；发布尝试 ', weekly.budget.publications, '/', weekly.budget.publicationLimit, '。每账号每周最多尝试一次；失败或结果未知不会重发。'),
            ...weekly.drafts.map(d => h('p', { key: d.id }, h('button', { onClick: () => { setWeeklyId(d.id); setWeeklyEdit(null); setWeeklyReviewed(''); setWeeklyImage(''); } },
              d.weekKey + ' · ' + weeklyStates[d.state] + ' · UID ' + d.accountUid))),
            h('div', { className: 'row' },
              h('button', { disabled: sendingBlocked || weeklyDirty || !weeklyOffset, onClick: () => {
                weeklyPage.current = Math.max(0, weeklyOffset - (weekly.pageSize || 5)); setWeeklyOffset(weeklyPage.current); setWeeklyId(''); setWeeklyImage(''); act('status'); } }, '较新草稿'),
              h('span', { className: 'muted' }, '共 ', weekly.total ?? weekly.drafts.length, ' 份'),
              h('button', { disabled: sendingBlocked || weeklyDirty || (weeklyOffset || 0) + (weekly.pageSize || 5) >= (weekly.total ?? weekly.drafts.length), onClick: () => {
                weeklyPage.current = (weeklyOffset || 0) + (weekly.pageSize || 5); setWeeklyOffset(weeklyPage.current); setWeeklyId(''); setWeeklyImage(''); act('status'); } }, '更早草稿'))),
          h('details', null, h('summary', null, '配图空间管理'),
            button('检查可回收图片', 'weekly_cleanup', {}, sendingBlocked || weeklyDirty),
            weekly.storage && h('p', { className: 'muted' }, '可回收 ', weekly.storage.workspace.reclaimable + (weekly.storage.staging?.reclaimable || 0), ' 张，约 ',
              ((weekly.storage.workspace.bytes + (weekly.storage.staging?.bytes || 0)) / 1048576).toFixed(1), ' MB；引用中的图片与内容被替换的文件保留。'),
            weekly.storage && button('确认回收未引用图片', 'weekly_cleanup', { confirmed: true }, sendingBlocked || weeklyDirty),
            (weekly.storage?.workspace.more || weekly.storage?.staging?.more) && h('p', { className: 'muted' }, '还有文件未扫描，可再次检查和回收。'))),
        h('section', { id: 'bili-tab-advanced', hidden: tab !== 'advanced' }, h('h3', null, '工作区与唯一对话'),
          h('details', null, h('summary', null, '隐私与外发保护'),
            h('p', { className: 'muted' }, status.privacy?.warning || '敏感信息拦截始终开启。模型无工具，凭据不进入模型；Windows旧凭据由新版读取进程首次读取时升级为当前系统用户加密。'),
            h('p', { className: 'muted' }, '同一对话含私信后，不自动公开发送；跨联系人自动私信也需隐私审核。审核绑定本条文案及当前上下文，5分钟过期。正则无法识别所有语义隐私，请人工核对。'),
            h('label', null, h('span', null, '额外保护的姓名、地址或隐私词（每行一条，最多50条）'),
              h('textarea', { rows: 3, value: (config.privacyBlockedTerms || []).join('\n'), disabled: sendingBlocked,
                onChange: e => setConfig({ ...config, privacyBlockedTerms: e.target.value.split(/\r?\n/) }) })),
            h('p', { className: 'muted' }, '保护词只在本机校验，不作为学习素材；修改后请保存设置。插件本地记录不等于加密保险箱，不要公开数据目录。')),
          h('label', null, h('span', null, '目标工作区'),
            h('select', { value: workspace, disabled: busy || binding.phase !== 'unbound',
              onChange: e => setWorkspace(e.target.value) },
            ...status.workspaces.map(w => h('option', { key: w.id, value: w.id }, w.title + ' · ' + w.path)))),
          binding.reason && h('p', { className: 'notice error' }, binding.reason),
          binding.sessionId && h('p', { className: 'muted' }, '固定标识：', h('code', null, binding.sessionId)),
          h('div', { className: 'row' },
            button(binding.phase === 'unbound' ? '绑定并创建专用对话' : '检查并恢复原绑定', 'bind',
              { workspaceId: workspace }, !workspace || !!active, binding.phase === 'unbound'),
            h('button', { disabled: !binding.sessionId || busy,
              onClick: () => { try { openSession(binding.sessionId); close?.(); } catch(e) { setError(e.message); } } }, '打开汇总对话'),
            button('检查模型接入', 'probe', { requestId: crypto.randomUUID() }, binding.phase !== 'active' || !!active),
            button('压缩原对话', 'compact', {}, binding.phase !== 'active' || !!active)),
          inline('binding'),
          h('p', { className: 'muted' }, '重复绑定、检查和重启均保留同一标识。若压缩接口不可用，可在汇总对话使用 /compact。'),
          h('details', null, h('summary', null, '诊断与交接'),
            button('生成本地诊断报告', 'diagnostics', {}, busy),
            diagnostic && h('div', null, h('pre', null, JSON.stringify(diagnostic, null, 2)),
              h('button', { onClick: () => {
                try {
                  const url = URL.createObjectURL(new Blob([JSON.stringify(diagnostic, null, 2)], { type: 'application/json' }));
                  const link = document.createElement('a'); link.href = url; link.download = 'bilibili-harness-diagnostics.json'; link.click();
                  setTimeout(() => URL.revokeObjectURL(url), 1000);
                } catch { setError('无法自动保存，请复制上方诊断文字。'); }
              } }, '保存诊断JSON')),
            h('p', { className: 'muted' }, '报告只包含运行状态与计数，适合排错；不包含账号、正文、人设、凭据或本地路径。'))),
        tab === 'advanced' && probe && h('p', { className: 'notice', role: 'status' },
          '最近接入检查：', probe.state === 'completed' ? '已通过' : states[probe.state] || probe.state,
          probe.error ? ' · ' + probe.error.message : '', probe.waitReason || ''),
        h('section', { hidden: tab !== 'advanced' }, h('h3', null, '读取环境与账号'),
          h('p', { className: 'muted' }, '环境准备：',
            ({ idle: '待检查', installing: '正在准备', ready: '已就绪', failed: '未完成', cancelled: '已停止准备' })[status.install.state] || status.install.state,
            installing ? ' · ' + (installStages[status.install.stage] || '准备中') : '',
            status.install.state === 'ready' && status.install.version ? ' · bilibili-api-python ' + status.install.version : '',
            status.install.error ? ' · ' + status.install.error.message : ''),
          h('div', { className: 'row' },
            button('准备 Python 依赖', 'install_python', {}, !!active || !!browsing?.round || !!browsing?.busy || status.install.state === 'installing'),
            button('检查读取环境', 'reader_ping'),
            button('检查登录', 'account', {}, installing, false, accountDone)),
          inline('reader'),
          account && h('p', null, accountStates[account.status] || account.status,
            account.name ? ' · ' + account.name + '（' + account.uid + '）' : '', account.message || ''),
          h('div', { className: 'row' },
            button('生成登录二维码', 'login_start', {}, !!active || installing, false, accountDone),
            button('检查扫码结果', 'login_poll', {}, !qr || installing, false, accountDone),
            button('退出插件账号', 'logout', {}, !!active || installing, false, accountDone)),
          installing && h('p', { className: 'muted' }, '环境准备结束后即可扫码登录，进度会自动更新。'),
          inline('login'),
          qr && h('img', { className: 'qr', src: qr, alt: 'B站登录二维码，请用自己的账号扫码并在手机确认' }),
          qr && h('p', { className: 'muted' }, '用 B站 App 扫码并在手机确认。面板会自动检查结果；过期时可重新生成。'),
          field('已有 Python 解释器（可留空，优先使用插件独立环境）', 'pythonPath')),
        h('section', { hidden: tab !== 'advanced' }, h('h3', null, '本地讲话转写'),
          h('p', { className: 'muted' }, '仅用于普通视频无字幕时转写讲话。ASMR使用评论区概述，无需准备音频依赖或模型。'),
          h('div', { className: 'two' },
            h('label', null, h('span', null, '准备的转写模型'), h('select', { value: config.asrDownloadModel || 'small',
              disabled: busy || !!active || installing, onChange: e => setConfig({ ...config, asrDownloadModel: e.target.value }) },
            ...[['tiny', 'tiny（小体积，适合先验证）'], ['base', 'base'], ['small', 'small（与参考插件默认相同）'], ['medium', 'medium（需要更多资源）']]
              .map(([value, label]) => h('option', { key: value, value }, label)))),
            h('label', null, h('span', null, '模型下载源'), h('select', { value: config.asrDownloadSource || 'official',
              disabled: busy || !!active || installing, onChange: e => setConfig({ ...config, asrDownloadSource: e.target.value }) },
            h('option', { value: 'official' }, 'Hugging Face 官方'), h('option', { value: 'mirror' }, 'hf-mirror.com（第三方镜像）')))),
          h('div', { className: 'row' },
            button('一键准备转写模型', 'prepare_asr_model', { model: config.asrDownloadModel || 'small', source: config.asrDownloadSource || 'official' },
              !!active || installing || !!browsing?.round || !!browsing?.busy, true),
            installing && status.install.kind === 'model' && button('停止准备模型', 'cancel_asr_model')),
          h('p', { className: 'muted' }, '点击后才安装音频依赖并下载选定模型；模型约几十MB至数GB。完成后自动填入目录，转写开关仍在浏览页控制。已有验证模型会复用。'),
          installing && ['model', 'audio'].includes(status.install.kind) && h('p', { className: 'notice', role: 'status' },
            installStages[status.install.stage] || '准备中', status.install.packageName ? ' · ' + status.install.packageName : '',
            Number.isFinite(status.install.totalBytes) ? ' · ' + (status.install.downloadedBytes / 1048576).toFixed(1) +
              '/' + (status.install.totalBytes / 1048576).toFixed(1) + ' MiB' : '',
            Number.isFinite(status.install.elapsedSeconds) ? ' · 已用 ' + status.install.elapsedSeconds + ' 秒' : '',
            status.install.quietSeconds >= 20 ? ' · 暂未收到新进度，可以停止后重试。' : ''),
          field('已有CTranslate2 Whisper模型目录（绝对路径）', 'asrModelPath'),
          field('音频处理超时（秒，30～1800）', 'audioTimeoutSeconds', 'number'),
          h('p', { className: 'muted' }, '也可手填已有目录，先保存再检查。模型需有model.bin、config.json、tokenizer.json。平时浏览不会下载模型；本机CPU转写不上传音频。'),
          h('div', { className: 'row' },
            button('准备音频依赖', 'install_audio', {}, !!active || installing || !!browsing?.round || !!browsing?.busy),
            button('检查音频环境', 'audio_check', {}, !!active || installing),
            button('清理遗留音频缓存', 'audio_cleanup', {}, !!active || installing),
            installing && status.install.kind === 'audio' && button('停止准备音频依赖', 'cancel_audio', {}, status.install.stage === 'stopping')),
          status.install.kind === 'audio' && status.install.error && h('p', { className: 'notice error', role: 'status' }, status.install.error.message),
          inline('audio'),
          !installing && status.audio?.environment?.message && !(status.install.kind === 'audio' && status.install.message) &&
            h('p', { className: 'muted' }, status.audio.environment.message),
          status.install.message && h('p', { className: 'muted' }, status.install.message)),
        h('nav', { className: 'subtabs', hidden: tab !== 'persona', role: 'tablist', 'aria-label': '人设分区' },
          ...[['base', '基础'], ['iteration', '迭代'], ['expressions', '表达'], ['review', '复盘'], ['settings', '设置']].map(([id, label]) =>
            h('button', { key: id, role: 'tab', 'aria-selected': personaView === id, onClick: () => setPersonaView(id) }, label))),
        h('section', { id: 'bili-tab-persona', hidden: tab !== 'persona' || personaView !== 'base' }, h('h3', null, '基础人设 · 由你填写'),
          h('label', null, h('span', null, '基础人设'),
            h('textarea', { rows: 4, maxLength: 4000, value: config.persona, disabled: busy || !!active,
              onChange: e => setConfig({ ...config, persona: e.target.value }) })),
          h('div', { className: 'two' }, field('每次最多读取的内容字符数（1000～30000）', 'maxContentChars', 'number'),
            field('评论草稿字数上限（20～500）', 'commentMaxChars', 'number')),
          h('p', { className: 'muted' }, '这一层只由你修改。大肥鱼自己的变化在“迭代”子页，始终服从这里的基础设定。“保存基础人设”提交本页的人设、字数限制与使用者身份；学习设置在“设置”子页单独保存。')),
        status.learning && h('section', { id: 'bili-iteration', className: 'persona-pane', hidden: tab !== 'persona' || personaView === 'base' },
          h('h3', null, ({ iteration: '迭代人设 · 大肥鱼自主选择', expressions: '表达记忆', review: '日终比较与学习汇报', settings: '学习设置' })[personaView]),
          personaView === 'iteration' && h('p', { className: 'muted' }, '每天结束后与过去的迭代和学习记忆比较，再决定保留、调整或淘汰；你只提供建议，不需要逐条批准。'),
          h('div', null,
          h('div', { className: 'iteration-card', hidden: personaView !== 'iteration' },
            h('strong', null, '迭代版本 ', status.learning.iteration.version, ' · ', status.learning.enabled ? '自主学习已开启' : '自主学习已关闭'),
            status.learning.iteration.traits.length ? status.learning.iteration.traits.map(t => h('details', { key: t.id },
              h('summary', null, t.text), h('p', null, t.reason), h('p', { className: 'muted' }, '来源：',
                t.sourceRefs?.length ? t.sourceRefs.map((s, i) => h(React.Fragment, { key: i }, s.url ? h('a', { href: s.url, target: '_blank', rel: 'noopener noreferrer' }, s.title || s.bvid) : h('span', null, s.title), ' ')) : '保留在对应日终复盘中。'))) :
              h('p', { className: 'muted' }, '尚未形成迭代人设；没有足够的新经历时可以保持不变。')),
          personaView === 'iteration' && status.feedback && h('details', null, h('summary', null, '交流反馈与私信复盘素材（', status.feedback.total, '份）'),
            h('p', { className: 'muted' }, '只是反思候选，日终比较后由大肥鱼决定是否采纳；私信仅保留固定表达建议，不保存原文或身份。'),
            button('检查评论回复反馈', 'feedback_scan', {}, sendingBlocked || !status.feedback.enabled || !!browsing?.round),
            button('整理本地私信线索', 'feedback_private_scan', {}, sendingBlocked || !status.feedback.enabled || !!browsing?.round),
            h('p', { className: 'muted' }, '公开表达反馈 ', status.feedback.publicFeedback || 0, ' · 私信表达反馈 ', status.feedback.privateFeedback || 0, ' · 私信对话复盘 ', status.feedback.privateConversations || 0,
              '。普通对话不代表批评；同一联系人每天的普通对话合并一份，具体风格线索另计。'),
            !status.feedback.enabled && h('p', { className: 'muted' }, '自主学习或交流学习未开启，当前不采集新素材。'),
            status.feedback.notice && h('p', { className: 'notice' }, status.feedback.notice),
            ...status.feedback.recent.map(f => h('p', { key: f.id }, f.scope === 'public_reply' ? '公开回复 · ' : f.scope === 'private_dialogue' ? '私信对话复盘（已脱敏） · ' : '私信风格线索（已脱敏） · ', f.summary,
              f.quote ? ' · “' + f.quote + '”' : '', f.includedInReview ? ' · 已进入复盘' : ' · 待日终比较',
              f.url && h('a', { href: f.url, target: '_blank', rel: 'noopener noreferrer' }, ' 查看来源')))),
          personaView === 'iteration' && h('details', null, h('summary', null, '反思中的不足与创意想法'),
            h('p', { className: 'muted' }, '提案保存在原工作区，和已采用的迭代分开；你可在人设→设置给方向建议，不会自动执行。'),
            status.learning.projection?.ideasPath && h('p', { className: 'muted' }, '工作区文件：', status.learning.projection.ideasPath),
            ...(status.learning.creativeIdeas || []).map((i, n) => h('details', { key: n }, h('summary', null, i.day, ' · ', i.issue),
              h('p', null, '想法：', i.idea), h('p', null, '下次的小实验：', i.trial), h('p', { className: 'muted' }, i.reason)))),
          h('div', { id: 'bili-learning-settings', hidden: personaView !== 'settings' },
            checkbox('开启自主学习与日终比较迭代', 'learningEnabled'),
            h('details', { className: 'knowledge-packs' }, h('summary', null, '学习知识包（可选）'),
              h('p', { className: 'muted' }, '默认不加载，继续自行培养。选择后点“保存学习设置”；开启自主学习后才会参考建议，不增加模型调用。基础人设和原有权限始终优先。'),
              ...(status.learning.knowledgePacks || []).map(pack => h('div', { key: pack.id, className: 'iteration-card' },
                h('label', { className: 'row' }, h('input', { type: 'checkbox', checked: (config.learningKnowledgePacks || []).includes(pack.id), disabled: sendingBlocked,
                  onChange: e => setConfig({ ...config, learningKnowledgePacks: e.target.checked ? [...(config.learningKnowledgePacks || []), pack.id] :
                    (config.learningKnowledgePacks || []).filter(id => id !== pack.id) }) }), pack.title),
                h('p', null, pack.description),
                h('p', { className: 'muted' }, '已保存状态：', pack.active ? '已加载' : pack.selected ? '已选择，自主学习关闭时不加载' : '未加载', ' · 包版本 ', pack.version),
                h('a', { href: pack.source.url, target: '_blank', rel: 'noopener noreferrer' }, '参考来源：' + pack.source.name + ' · ' + pack.source.version),
                h('details', null, h('summary', null, '查看建议与边界'), h('ul', null, ...pack.rules.map((rule, i) => h('li', { key: i }, rule)))))),
              h('p', { className: 'muted' }, '知识包与基础人设、迭代记忆分开保存；日终仍需比较真实经历后自主决定。取消加载会停止后续注入，旧对话和已形成的迭代不自动删除，可按需回滚。')),
            checkbox('学习公开回复和私信对话（仅保留脱敏线索）', 'learningFeedbackEnabled'),
            checkbox('反思时提出不足与创意想法，保存到原工作区', 'learningCreativeIdeas'),
            timeField('日终复盘时间（比较上一完整日）', 'learningDailyTime'),
            field('每天最多复盘调用（0停止复盘，含补做历史日）', 'learningDailyReviewLimit', 'number'),
            h('p', { className: 'muted' }, '采用浏览统计时区 ' + config.timeZone + '。DSH保持运行且原对话/浏览轮次空闲后执行；重启处理未复盘的完整日，同一材料不重复统计。'),
            h('label', null, h('span', null, '我给大肥鱼的建议（可选，由它判断是否采纳）'),
              h('textarea', { rows: 3, maxLength: 1000, value: config.learningAdvice || '', disabled: sendingBlocked,
                onChange: e => setConfig({ ...config, learningAdvice: e.target.value }) })),
            checkbox('复盘时向我汇报每日学习情况', 'learningDailyReport'),
            h('label', null, h('span', null, '汇报详情'), h('select', { value: config.learningReportDetail, disabled: sendingBlocked,
              onChange: e => setConfig({ ...config, learningReportDetail: e.target.value }) }, h('option', { value: 'brief' }, '简短概览'), h('option', { value: 'full' }, '来源与例句'))),
            checkbox('汇报中附上它选择的后续探索方向', 'learningDirectionSuggestions'),
            h('p', { className: 'muted' }, '关闭汇报仍会比较并迭代。基础人设不会被覆盖；私信只派生脱敏复盘线索。每次只加载少量表达，不要求每句话都带梗。')),
          h('div', { className: 'row', hidden: !['iteration', 'review'].includes(personaView) }, button('复盘上一完整日', 'learning_review', {}, sendingBlocked || !!browsing?.round || !status.learning.enabled || !status.learning.accountUid),
            button('更新工作区学习快照', 'learning_project', {}, sendingBlocked || !status.learning.accountUid)),
          status.learning.budget && h('p', { className: 'muted', hidden: personaView === 'expressions' }, '今日复盘调用 ', status.learning.budget.calls, '/', status.learning.budget.limit, '；等待、失败与结果未知不会自动重投。'),
          status.learning.notice && h('p', { className: 'notice' }, status.learning.notice),
          status.learning.projection?.state === 'failed' && h('p', { className: 'notice error' }, status.learning.projection.message),
          status.learning.archiveNotice && h('p', { className: 'notice error' }, status.learning.archiveNotice),
          inline('learning'),
          h('div', { id: 'bili-learning-expressions', hidden: personaView !== 'expressions' },
            h('p', { className: 'muted' }, '候选 ', status.learning.counts.candidate, ' · 采用 ', status.learning.counts.active, ' · 降频 ', status.learning.counts.reduced,
              ' · 停用 ', status.learning.counts.inactive, ' · 禁用 ', status.learning.counts.blocked, ' · 归档 ', status.learning.counts.archived || 0, '。同一视频只算一个独立来源，至少两个来源才可自主采用。'),
            !status.learning.focus && h('details', { id: 'bili-learning-filter' }, h('summary', null, '搜索与筛选表达', learningView.q || learningView.state && learningView.state !== 'all' ? ' · 已筛选' : ''),
              h('label', null, h('span', null, '搜索表达、含义或适用场景'), h('input', { value: learningSearch?.q || '', maxLength: 100, disabled: busy,
                onChange: e => setLearningSearch({ ...learningSearch, q: e.target.value }) })),
              h('label', null, h('span', null, '表达状态'), h('select', { value: learningSearch?.state || 'all', disabled: busy,
                onChange: e => setLearningSearch({ ...learningSearch, state: e.target.value }) }, h('option', { value: 'all' }, '全部状态'),
                ...Object.entries(learningStates).map(([value, label]) => h('option', { key: value, value }, label)))),
              h('div', { className: 'row' }, h('button', { disabled: busy, onClick: () => changeLearningView({ q: learningSearch?.q || '', state: learningSearch?.state || 'all', entity: '', sourceOffset: 0, eventOffset: 0 }, true) }, '应用表达筛选'),
                h('button', { disabled: busy, onClick: () => { setLearningSearch({ q: '', state: 'all' }); return changeLearningView({ q: '', state: 'all', entity: '', sourceOffset: 0, eventOffset: 0 }, true); } }, '清除表达筛选'))),
            status.learning.focus ? h('div', { id: 'bili-learning-dossier' },
              h('button', { disabled: busy, onClick: () => changeLearningView({ entity: '', sourceOffset: 0, eventOffset: 0 }) }, '返回表达列表'),
              h('h3', null, status.learning.focus.entry.expression), h('p', null, status.learning.focus.entry.meaning),
              h('p', { className: 'muted' }, learningStates[status.learning.focus.entry.state], ' · 适用：', status.learning.focus.entry.context, '；避免：', status.learning.focus.entry.avoid || '未注明'),
              h('details', null, h('summary', null, '完整来源 · ', status.learning.focus.sourceTotal, '个视频'),
                ...status.learning.focus.sources.map(s => h('p', { key: s.bvid }, h('a', { href: s.url, target: '_blank', rel: 'noopener noreferrer' }, s.bvid), ' · ', s.quote)),
                h('div', { className: 'row' },
                  h('button', { disabled: busy || !status.learning.focus.sourceOffset, onClick: () => changeLearningView({ sourceOffset: Math.max(0, status.learning.focus.sourceOffset - 10) }) }, '上10个来源'),
                  h('span', { className: 'muted' }, rangeText(status.learning.focus.sourceOffset, 10, status.learning.focus.sourceTotal)),
                  h('button', { disabled: busy || status.learning.focus.sourceOffset + 10 >= status.learning.focus.sourceTotal, onClick: () => changeLearningView({ sourceOffset: status.learning.focus.sourceOffset + 10 }) }, '下10个来源'))),
              h('details', null, h('summary', null, '这个表达的变更档案'), renderLearningEvents())) : h(React.Fragment, null,
            ...status.learning.entries.map(e => h('details', { key: e.id }, h('summary', null, e.expression, ' · ', learningStates[e.state], ' · ', e.sourceCount, '个视频'),
              h('p', null, e.meaning), h('p', { className: 'muted' }, '适用：', e.context, '；避免：', e.avoid || '未注明'),
              h('blockquote', null, '示例（不表示已发表）：', e.example), h('p', { className: 'muted' }, '草稿实际使用 ', e.uses, '次；不作为发送次数。'),
              ...e.sources.map(s => h('p', { key: s.bvid }, h('a', { href: s.url, target: '_blank', rel: 'noopener noreferrer' }, s.bvid), ' · ', s.quote)),
              e.sourceCount > e.sources.length && h('p', { className: 'muted' }, '这里显示部分来源，可展开完整档案继续查看。'),
              h('div', { className: 'row' },
                h('button', { disabled: busy, onClick: () => changeLearningView({ entity: e.id, sourceOffset: 0, eventOffset: 0 }) }, '查看完整来源与变更'),
                button(e.state === 'blocked' ? '解除禁用，恢复候选' : '禁用这个表达', 'learning_change', { id: e.id, version: e.version, operation: e.state === 'blocked' ? 'unblock' : 'block' }, sendingBlocked),
                e.state !== 'blocked' && button('降低使用频率', 'learning_change', { id: e.id, version: e.version, operation: 'reduce' }, sendingBlocked),
                e.rollbackEventId && (learningConfirm === e.id ? button('确认回滚此表达', 'learning_change', { id: e.id, version: e.version, operation: 'rollback', eventId: e.rollbackEventId }, sendingBlocked) :
                  h('button', { disabled: sendingBlocked, onClick: () => setLearningConfirm(e.id) }, '回滚最近变化'))))),
            h('div', { className: 'row' }, h('button', { disabled: busy || learningOffset === 0, onClick: () => { const next = Math.max(0, learningOffset - 10); setLearningOffset(next); learningPage.current = next; act('status'); } }, '上10条表达'),
              h('span', { className: 'muted' }, rangeText(learningOffset, 10, status.learning.total)),
              h('button', { disabled: busy || learningOffset + 10 >= status.learning.total, onClick: () => { const next = learningOffset + 10; setLearningOffset(next); learningPage.current = next; act('status'); } }, '下10条表达')))),
          h('div', { id: 'bili-learning-reviews', hidden: personaView !== 'review' },
            h('details', { id: 'bili-review-filter' }, h('summary', null, '筛选历史复盘', learningView.reviewFrom || learningView.reviewTo || learningView.reviewState && learningView.reviewState !== 'all' ? ' · 已筛选' : ''),
              h('div', { className: 'two' }, ...[['reviewFrom', '开始日期'], ['reviewTo', '结束日期']].map(([key, label]) => h('label', { key }, h('span', null, label),
                h('input', { type: 'date', value: reviewFilters?.[key] || '', disabled: busy, onChange: e => setReviewFilters({ ...reviewFilters, [key]: e.target.value }) })))),
              h('label', null, h('span', null, '复盘状态'), h('select', { value: reviewFilters?.reviewState || 'all', disabled: busy,
                onChange: e => setReviewFilters({ ...reviewFilters, reviewState: e.target.value }) },
                ...[['all', '全部状态'], ['completed', '已比较'], ['failed', '未应用'], ['reading', '等待复盘']].map(([value, label]) => h('option', { key: value, value }, label)))),
              h('p', { className: 'muted' }, '按复盘当时保存的日期筛选；查看与导出不增加模型调用。'),
              h('div', { className: 'row' }, h('button', { disabled: busy, onClick: () => changeLearningView({ reviewFrom: reviewFilters?.reviewFrom || '', reviewTo: reviewFilters?.reviewTo || '', reviewState: reviewFilters?.reviewState || 'all', reviewOffset: 0 }) }, '应用复盘筛选'),
                h('button', { disabled: busy, onClick: () => { const reset = { reviewFrom: '', reviewTo: '', reviewState: 'all' }; setReviewFilters(reset); return changeLearningView({ ...reset, reviewOffset: 0 }); } }, '清除复盘筛选'))),
            ...status.learning.reviews.map(r => h('details', { key: r.id }, h('summary', null, r.day, ' · ', ({ reading: '等待复盘', completed: '已比较', failed: '未应用，保留旧状态' })[r.state] || r.state),
              h('p', { className: 'muted' }, dateText(r.start), '—', dateText(r.end), ' · ', r.zone, ' · 本期 ', r.stats.observations, '次记录 / ', r.stats.videos, '个独立视频'),
              h('p', null, r.comparison || r.error || '等待原对话完成；不会重复投递。'),
              r.expressionChanges?.map(e => h('p', { key: e.id }, e.expression, ' · ', ({ adopt: '采用', reduce: '降频', stop: '停用' })[e.action], '：', e.reason)),
              r.iterationAfter && h('div', { className: 'two' }, h('div', null, h('strong', null, '比较前'), ...r.iterationBefore.traits.map(t => h('p', { key: t.id }, t.text))),
                h('div', null, h('strong', null, '选择保留后的迭代'), ...r.iterationAfter.traits.map(t => h('p', { key: t.id }, t.text)))),
              r.report && h('pre', null, r.report), r.direction && h('p', null, '后续探索：', r.direction),
              r.omittedSources > 0 && h('p', { className: 'muted' }, '仅选取30条材料，其余 ', r.omittedSources, '条未提供给本轮模型。'),
              r.state === 'reading' && button('核对原复盘结果', 'reconcile', { requestId: r.id }, busy),
              r.exportable && button('导出这份复盘到工作区', 'learning_export', { reviewId: r.id }, sendingBlocked),
              status.learning.iteration.lastReview === r.id && (learningConfirm === r.id ? button('确认回滚迭代人设', 'learning_rollback', { reviewId: r.id, version: status.learning.iteration.version }, sendingBlocked) :
                h('button', { disabled: sendingBlocked, onClick: () => setLearningConfirm(r.id) }, '回滚本次迭代人设')))),
            h('div', { className: 'row' },
              h('button', { disabled: busy || !status.learning.reviewPage?.offset, onClick: () => changeLearningView({ reviewOffset: Math.max(0, status.learning.reviewPage.offset - 5) }) }, '上5份复盘'),
              h('span', { className: 'muted' }, rangeText(status.learning.reviewPage?.offset || 0, 5, status.learning.reviewPage?.total || status.learning.reviews.length)),
              h('button', { disabled: busy || !status.learning.reviewPage || status.learning.reviewPage.offset + 5 >= status.learning.reviewPage.total, onClick: () => changeLearningView({ reviewOffset: status.learning.reviewPage.offset + 5 }) }, '下5份复盘')),
            h('details', null, h('summary', null, '变更档案'),
              h('label', null, h('span', null, '查看范围'), h('select', { value: learningView.entity || '', disabled: busy,
                onChange: e => changeLearningView({ entity: e.target.value, eventOffset: 0, sourceOffset: 0 }) },
                h('option', { value: '' }, '全部变更'), h('option', { value: 'iteration' }, '仅迭代人设'),
                learningView.entity && learningView.entity !== 'iteration' && h('option', { value: learningView.entity }, '当前表达'))),
              renderLearningEvents())))),
        h('section', { hidden: tab !== 'persona' || personaView !== 'base' },
          h('details', null, h('summary', null, '使用者的 B站账号（可选）'),
          checkbox('告诉 DeepSeek 谁是使用者（主人）', 'ownerAccountEnabled'),
          field('使用者 UID 或 B站主页链接', 'ownerAccountUid'),
          button('查询账号', 'lookup_owner', { uid: config.ownerAccountUid },
            !String(config.ownerAccountUid || '').trim() || !!active || installing || !!social?.busy || !!browsing?.busy || !!browsing?.round,
            false, value => setOwnerProfile({ ...value, input: String(config.ownerAccountUid || '').trim() })),
          inline('owner'),
          shownOwnerProfile && h('div', { className: 'owner-profile', role: 'status' },
            shownOwnerProfile.face && h('img', { src: shownOwnerProfile.face, alt: 'B站账号头像', referrerPolicy: 'no-referrer',
              onError: e => { e.currentTarget.hidden = true; } }),
            h('div', null, h('strong', null, 'B站账号：', shownOwnerProfile.name),
              h('div', { className: 'muted' }, 'UID ', shownOwnerProfile.uid),
              h('div', { className: 'muted' }, '上次查询：', dateText(shownOwnerProfile.checkedAt)),
              h('a', { href: shownOwnerProfile.profile, target: '_blank', rel: 'noopener noreferrer' }, '查看这个账号的主页'))),
          h('p', { className: 'muted' }, '查询显示B站实际昵称，不会改动下面的昵称或自动保存身份设置。修改UID后请重新查询。'),
          field('使用者昵称（可选，仅用于显示）', 'ownerAccountName'),
          checkbox('探索：使用者低于60分时，态度随分数逐渐变冷、变得不耐烦', 'ownerAttitudeEnabled'),
          h('p', { className: 'muted' }, '使用者与插件登录账号分别设置，以UID识别；使用者不占前100名，低分仍可回复。关闭身份开关后，后续任务会明确停用旧身份。保存设置不会创建新对话。'))),
        social && h('section', { id: 'bili-tab-people', hidden: tab !== 'people' },
          h('nav', { className: 'subtabs people-tabs', role: 'tablist', 'aria-label': '关系与私信分区' },
            ...[['messages', '私信会话'], ['contacts', '联系人'], ['settings', '设置']].map(([value, label]) =>
              h('button', { key: value, type: 'button', role: 'tab', 'aria-selected': (peopleView || 'messages') === value,
                'aria-controls': 'bili-people-' + value, onClick: () => setPeopleView(value) }, label)))),
        social && h('section', { id: 'bili-people-contacts', hidden: tab !== 'people' || (peopleView || 'messages') !== 'contacts' }, h('h3', null, '联系人与评分'),
          h('div', { className: 'owner-card' }, h('strong', null, '使用者 · 独立身份 · 不参与前100名排名'),
            social.owner ? h(React.Fragment, null,
              h('div', { className: 'contact-line' }, h('span', null, social.owner.name || '使用者', ' · UID ', social.owner.uid),
                h('span', { className: 'score' }, social.owner.score, ' / 100')), personBody(social.owner)) :
              h('p', { className: 'muted' }, status.config.ownerAccountEnabled ? '先在高级检查登录，载入该账号下的使用者评分。' : '尚未启用使用者身份，可在人设页填写。'),
            h('button', { onClick: () => { setPersonaView('base'); setTab('persona'); } }, '设置使用者账号')),
          h('h4', null, '其他认识的人'),
          h('p', { className: 'muted' }, '已验证粉丝才算认识。友善度达到60分，按分数前100名获得回复资格；同分按UID排序。初始50分，来信评价每次最多调整10分，也可手动调整。'),
          h('div', { className: 'row' },
            button('导入粉丝第' + social.importPage + '页', 'import_fans', { page: social.importPage }, !!active || installing || !!social.busy),
            h('span', { className: 'muted' }, '当前查询 ', social.total, ' 人 · 有资格 ', social.eligibleCount, '/100')),
          social.accountUid && h('p', { className: 'muted' }, '联系人归属：大肥鱼登录账号 UID ', social.accountUid),
          h('label', null, h('span', null, '查找昵称或UID'), h('input', { value: contactQuery, maxLength: 100, onChange: e => {
            setContactQuery(e.target.value); setContactOffset(0); contactPage.current = { offset: 0, query: e.target.value };
          } })),
          ...social.people.map(person => h('details', { key: person.uid },
            h('summary', null, person.name || '粉丝', ' · UID ', person.uid, ' · ', person.score, '分 · ',
              person.eligibility.rank ? '第' + person.eligibility.rank + '名 · ' : '', person.eligibility.allowed ? '可聊天' : person.eligibility.reason), personBody(person))),
          h('div', { className: 'row' },
            h('button', { disabled: busy || contactOffset === 0, onClick: () => { const next = Math.max(0, contactOffset - 20);
              setContactOffset(next); contactPage.current.offset = next; act('status'); } }, '前20人'),
            h('span', { className: 'muted' }, social.total ? contactOffset + 1 + '—' + Math.min(contactOffset + 20, social.total) : '尚无粉丝记录'),
            h('button', { disabled: busy || contactOffset + 20 >= social.total, onClick: () => { const next = contactOffset + 20;
              setContactOffset(next); contactPage.current.offset = next; act('status'); } }, '后20人')),
          h('p', { className: 'muted' }, '粉丝列表可能受平台分页限制；新来信也会单独核验。分数表示大肥鱼的互动感受，评价依据可展开查看。'),
          rating && h('div', { className: 'notice' }, h('strong', null, '调整 ', rating.uid === social.owner?.uid ? '使用者' : '粉丝', ' UID ', rating.uid),
            h('label', null, h('span', null, '友善度（0～100）'), h('input', { type: 'number', min: 0, max: 100, value: rating.score,
              onChange: e => setRating({ ...rating, score: Number(e.target.value) }) })),
            h('label', null, h('span', null, '调整理由'), h('textarea', { rows: 2, maxLength: 400, value: rating.evaluation,
              onChange: e => setRating({ ...rating, evaluation: e.target.value }) })),
            h('label', { className: 'row' }, h('input', { type: 'checkbox', checked: rating.blocked,
              onChange: e => setRating({ ...rating, blocked: e.target.checked }) }), '屏蔽此人的私信回复'),
            h('div', { className: 'row' }, button('保存评分', 'rate_contact', rating, !!social.busy || !!active || installing),
              h('button', { onClick: () => setRating(null) }, '取消调整')))),
        social && h('section', { id: 'bili-people-messages', hidden: tab !== 'people' || (peopleView || 'messages') !== 'messages' }, h('h3', null, '私信会话'),
          h('div', { className: 'row' }, h('span', { className: 'badge' }, social.paused ? '私信已暂停' : social.enabled ? social.autoSend ? '自动回复已开启' : '只生成私信草稿' : '私信已关闭'),
            h('span', null, '今日计额回复 ', social.budget.replies, '/', social.budget.replyLimit, ' · 计额评价 ', social.budget.evaluations, '/', social.budget.evaluationLimit),
            status.config.ownerAccountEnabled && h('span', { className: 'badge' }, '使用者普通回复不限 · 今日 ', social.budget.ownerReplies || 0, ' 次')),
          social.schedule && h('div', { className: 'notice', role: 'status' },
            h('div', null, '自动检查：', social.schedule.message),
            h('div', { className: 'muted' }, '上次检查：', social.schedule.lastCheckedAt ? dateText(social.schedule.lastCheckedAt) : '尚未检查',
              ' · 下次检查：', social.schedule.nextCheckAt ? dateText(social.schedule.nextCheckAt) : '未安排'),
            h('div', { className: 'muted' }, '发送方式：', social.schedule.replyMessage)),
          h('div', { className: 'row' }, button('检查新私信', 'dm_scan', {}, !social.enabled || social.paused || !!active || installing || !!social.busy),
            button('暂停私信', 'dm_pause', {}, social.paused), button('继续私信', 'dm_resume', {}, !social.paused)),
          inline('social'), social.notice && h('p', { className: 'notice' + (social.error ? ' error' : ''), role: 'status' }, social.notice),
          h('div', { className: 'dm-layout' },
            h('aside', { className: 'dm-person-list', 'aria-label': '按人查看私信' },
              conversations?.owner && h(React.Fragment, null, h('h4', null, '使用者'), privatePerson(conversations.owner)),
              h('h4', null, '其他联系人', conversations ? ' · ' + conversations.total : ''),
              h('label', null, h('span', null, '查找私信联系人'), h('input', { value: privateSearch || '', maxLength: 100, disabled: busy,
                placeholder: '昵称或UID', onChange: e => setPrivateSearch(e.target.value),
                onKeyDown: e => { if (e.key === 'Enter') changePrivateView({ q: privateSearch || '', peopleOffset: 0 }); } })),
              h('div', { className: 'row' }, h('button', { type: 'button', disabled: busy,
                onClick: () => changePrivateView({ q: privateSearch || '', peopleOffset: 0 }) }, '查找'),
                privateView.q && h('button', { type: 'button', disabled: busy, onClick: () => { setPrivateSearch(''); changePrivateView({ q: '', peopleOffset: 0 }); } }, '清除筛选')),
              ...(conversations?.people || []).map(privatePerson),
              !conversations?.people?.length && h('p', { className: 'muted' }, privateView.q ? '没有匹配的联系人。' : '暂无其他私信联系人。'),
              conversations && conversations.filteredTotal > conversations.pageSize && h('div', { className: 'row' },
                h('button', { disabled: busy || !privateView.peopleOffset, onClick: () => changePrivateView({ peopleOffset: Math.max(0, privateView.peopleOffset - conversations.pageSize) }) }, '前20位'),
                h('span', { className: 'muted' }, (privateView.peopleOffset || 0) / conversations.pageSize + 1, '页'),
                h('button', { disabled: busy || (privateView.peopleOffset || 0) + conversations.pageSize >= conversations.filteredTotal,
                  onClick: () => changePrivateView({ peopleOffset: (privateView.peopleOffset || 0) + conversations.pageSize }) }, '后20位'))),
            h('div', { className: 'dm-thread', 'aria-label': '当前联系人私信' },
              conversations?.selected ? h(React.Fragment, null,
                h('header', { className: 'dm-thread-head' }, h('h4', null, conversations.selected.name || (conversations.selected.isOwner ? '使用者' : '联系人'), ' ',
                  conversations.selected.isOwner && h('span', { className: 'identity-badge' }, '使用者')),
                  h('div', { className: 'muted' }, 'UID ', conversations.selected.uid, ' · ', conversations.selected.total, '条本地记录',
                    conversations.selected.drafts ? ' · ' + conversations.selected.drafts + '份待确认草稿' : '')),
                h('div', { className: 'dm-messages' }, ...(social.messages || []).map(privateMessage),
                  !social.messages?.length && h('p', { className: 'dm-empty' }, '这个人暂无本地私信记录。')),
                h('div', { className: 'row' },
                  h('button', { disabled: busy || !privateView.offset, onClick: () => changePrivateView({ offset: Math.max(0, privateView.offset - 10) }) }, '较新的10条'),
                  h('span', { className: 'muted' }, rangeText(privateView.offset || 0, 10, conversations.selected.total)),
                  h('button', { disabled: busy || (privateView.offset || 0) + 10 >= conversations.selected.total,
                    onClick: () => changePrivateView({ offset: (privateView.offset || 0) + 10 }) }, '更早的10条'))) :
                h('p', { className: 'dm-empty' }, '暂无私信会话。检查新私信后，会按联系人归类显示。')))),
        social && h('section', { id: 'bili-people-settings', hidden: tab !== 'people' || (peopleView || 'messages') !== 'settings' }, h('h3', null, '私信与关系设置'),
          h('details', null, h('summary', null, '私信设置'),
            checkbox('启用私信读取与评价（只处理启用后收到的新文本）', 'dmEnabled'),
            checkbox('自动发送通过资格检查的回复', 'dmAutoSend'),
            checkbox('私信自动检查沿用浏览活动时段（关闭则全天）', 'dmUseBrowseHours'),
            h('div', { className: 'two' }, field('每日计额回复上限（0关闭计额发送）', 'dmDailyReplyLimit', 'number'),
              field('普通联系人每日回复上限（0关闭）', 'dmPerPersonDailyLimit', 'number')),
            h('div', { className: 'two' }, field('每日计额私信评价上限（0关闭）', 'dmDailyEvaluationLimit', 'number'),
              field('新私信检查间隔（秒，至少60）', 'dmPollSeconds', 'number')),
            h('div', { className: 'two' }, field('同一人最短回复间隔（秒，至少60）', 'dmMinIntervalSeconds', 'number'),
              field('回复字数上限（20～1000）', 'dmMaxChars', 'number')),
            h('p', { className: 'muted' }, '使用者的普通来信评价与回复不限每日次数，也不占上述额度；100分主动问候仍独立限额。暂停、最短回复间隔、屏蔽、去重及隐私审核继续生效。自动检查可沿用浏览时段或全天，DSH需运行。'),
            button('保存私信设置', 'configure', { config: { ...config, keywords: (config.keywords || []).filter(k => k.trim()) } },
              !!active || installing || !!social.busy || !!browsing?.busy, true)),
          h('p', { className: 'muted' }, '仅检查最近20个私聊的最新文本；旧历史、非文本、自己发出的消息不触发。私信在原对话中评价，单独保存，不写入公开视频笔记。可清理本地内容，原对话消息保留。'),
          h('details', null, h('summary', null, '80分关注与100分每日主动私信（独立开关）'),
            checkbox('好感达到80分后自动关注认识的人（默认关闭）', 'autoFollowEnabled'),
            h('div', { className: 'two' }, field('每日最多自动关注次数（0关闭）', 'autoFollowDailyLimit', 'number'),
              field('自动关注间隔（秒，至少300）', 'autoFollowMinIntervalSeconds', 'number')),
            checkbox('好感100分后每天主动私信问候（默认关闭）', 'dmProactiveEnabled'),
            field('每日最多主动私信生成/发送次数（0关闭）', 'dmProactiveDailyLimit', 'number'),
            h('p', { className: 'muted' }, '已关注不计次数。主动私信不发到视频或动态；每人每天最多一次，最近24小时有互动不打扰。仍受前100名、屏蔽、总私信额度、活动时段和暂停限制。不同联系人的私密上下文需要逐条人工隐私审核，100分不能跳过。'),
            status.relationships && h('p', { className: 'muted', role: 'status' }, '今日关注尝试 ', status.relationships.budget.follows, '/', status.relationships.budget.followLimit,
              ' · 主动私信生成 ', status.relationships.budget.proactiveGenerations, '/', status.relationships.budget.proactiveLimit, ' · ', status.relationships.notice),
            button('保存关系互动设置', 'configure', { config: { ...config, keywords: (config.keywords || []).filter(k => k.trim()) } }, !!active || installing || !!social.busy || !!browsing?.busy, true))),
        h('section', { id: 'bili-tab-browse', hidden: tab !== 'browse' }, h('h3', null, '自动浏览'),
          browsing && h('div', { className: 'row' },
            h('span', { className: 'badge' }, browsing.paused ? '已暂停' : browsing.enabled ? '定时浏览已开启' : '定时浏览已关闭'),
            h('span', null, '轮次 ' + budget.rounds + '/' + budget.roundLimit + ' · 分析 ' + budget.analyses + '/' + budget.analysisLimit +
              ' · 独立视频 ' + budget.uniqueVideos)),
          h('div', { className: 'row' },
            button('立即运行一轮', 'run_now', { requestId: crypto.randomUUID() },
              binding.phase !== 'active' || sendingBlocked || !!browsing?.paused || !!browsing?.round || !(status.config.browseMode === 'autonomous' ? status.config.dailyBrowseChoiceLimit : status.config.browseTagEnabled ? status.config.browseTags?.length : status.config.keywords?.length), true),
            button('暂停', 'pause_browsing', {}, !!browsing?.paused),
            button('继续', 'resume_browsing', {}, !browsing?.paused)),
          inline('browsing'),
          browsing?.nextRunAt && h('p', { className: 'muted' }, '下次自动运行：', dateText(browsing.nextRunAt)),
          browsing?.schedule && h('p', { className: 'notice', role: 'status' }, browsing.schedule.message,
            h('span', { className: 'muted record-meta' }, '当前时间：', dateText(browsing.schedule.now), ' · ', browsing.schedule.timeZone)),
          browsing?.reason && h('p', { className: 'muted' }, browsing.reason),
          browsing?.error && h('p', { className: 'notice error' }, browsing.error.message),
          status.config.browseMode === 'autonomous' && h('p', { className: 'muted' }, '浏览方式：自主选片 · 今日选片调用 ', browsing?.autonomous?.budget?.calls || 0, '/', browsing?.autonomous?.budget?.limit ?? status.config.dailyBrowseChoiceLimit,
            '；每轮最多额外调用模型一次，视频评价另按分析次数计。'),
          browsing?.round && h('p', { className: 'notice' }, '本轮：', browsing.round.browseMode === 'autonomous' && browsing.round.state !== 'paused' && !browsing.round.selection ?
            browsing.round.choiceId ? '等待原对话自主选片' : '读取推荐、实际标签与简介' : roundStates[browsing.round.state], ' · ', browsing.round.keyword,
            ' · 已启动 ', browsing.round.analysisIds.length, '/', browsing.round.limit, ' 条'),
          choiceDetails(browsing?.round),
          browsing?.round?.choiceId && !browsing.round.selection && button('核对本轮选片结果', 'reconcile', { requestId: browsing.round.choiceId }, binding.running),
          status.config.browseMode !== 'autonomous' && !(status.config.browseTagEnabled ? status.config.browseTags?.length : status.config.keywords?.length) && h('p', { className: 'muted' }, '先展开“浏览设置”选择自主选片，或填写关键词/启用TAG浏览，再运行一轮。'),
          h('details', null, h('summary', null, '浏览设置'),
          h('div', { className: 'browse-options' },
          h('label', { className: 'row' }, h('input', { type: 'checkbox', checked: !!config.autoEnabled, disabled: busy || !!active,
            onChange: e => setConfig({ ...config, autoEnabled: e.target.checked }) }), '按活动时段自动浏览'),
          h('p', null, '浏览方式'), h('div', { role: 'group', 'aria-label': '浏览方式', className: 'row' },
            ...[['search', '关键词 / TAG'], ['autonomous', '自主选片']].map(([value, label]) => h('button', { key: value, type: 'button',
              'aria-pressed': (config.browseMode || 'search') === value, className: (config.browseMode || 'search') === value ? 'primary' : '', disabled: sendingBlocked,
              onClick: () => setConfig({ ...config, browseMode: value }) }, label))),
          config.browseMode === 'autonomous' && h('div', null,
            h('p', { className: 'muted' }, '从一批B站推荐中，按基础人设、启用的迭代人设和近期实际评价自主挑选；含实际标签和简介，可探索新主题，也可以这批都不看。无需关键词，保留的关键词和TAG不参与限制。'),
            field('每天最多自主选片调用（0关闭，每轮至多1次）', 'dailyBrowseChoiceLimit', 'number'),
            h('p', { className: 'muted' }, '只在原汇总对话选片。选片调用与视频分析分别计数，失败或结果未知不自动重投；推荐资料读取失败不会按标题放行或退回关键词搜索。')),
          h('div', { hidden: config.browseMode === 'autonomous' },
          h('label', null, h('span', null, '关键词（每行一个，最多20个）'),
            h('textarea', { rows: 3, value: (config.keywords || []).join('\n'), disabled: busy || !!active,
              onChange: e => setConfig({ ...config, keywords: e.target.value.split(/\r?\n/) }) })),
          h('details', null, h('summary', null, 'TAG标签限制' + (config.browseTagEnabled ? ' · 已启用' : ' · 可选')),
            checkbox('按实际TAG找视频（替代关键词检索）', 'browseTagEnabled'),
            h('label', null, h('span', null, 'B站实际TAG名（每行一个，最多10个，不加#）'),
              h('textarea', { rows: 3, maxLength: 1000, value: (config.browseTags || []).join('\n'), disabled: sendingBlocked,
                placeholder: '例如：ASMR\n助眠', onChange: e => setConfig({ ...config, browseTags: e.target.value.split(/\r?\n/) }) })),
            h('label', null, h('span', null, '多个TAG如何匹配'), h('select', { value: config.browseTagMatch, disabled: sendingBlocked,
              onChange: e => setConfig({ ...config, browseTagMatch: e.target.value }) },
              h('option', { value: 'any' }, '命中任一TAG'), h('option', { value: 'all' }, '必须全部命中'))),
            h('p', { className: 'muted' }, '用TAG名检索，再读取候选视频的实际标签，完整标签名匹配（忽略全半角、英文大小写）。标题命中而标签不符或读取失败的不会进入评价。TAG模式下保留原关键词但不参与检索；直接填写BV手动读取不受此限制。平台搜索可能漏召回，每轮只核对一页最多20个候选。'))),
          h('div', { className: 'two' }, field('每天最多浏览轮次（0关闭轮次）', 'dailyRoundLimit', 'number'),
            field('每天最多分析视频数（0关闭分析）', 'dailyAnalysisLimit', 'number')),
          h('div', { className: 'two' }, field('每轮最多分析视频数（1～10）', 'videosPerRound', 'number'),
            field('自动轮次间隔（分钟，至少5）', 'intervalMinutes', 'number')),
          h('div', { className: 'two' }, timeField('活动开始', 'activityStart'), timeField('活动结束', 'activityEnd', true)),
          h('p', { className: 'muted' }, '00:00是午夜，12:00是中午，24:00是当天结束（仅结束时间可选）。跨夜可设18:00～次日09:00。'),
          h('p', { className: 'muted' }, '活动开始与结束是每天允许自动浏览的时间范围。首次开启会等待最近的活动窗口；若已在时段内，后台将在15秒内检查。后续轮次再按间隔运行。'),
          h('div', { className: 'two' }, field('统计与活动时区（IANA）', 'timeZone'),
            field('每轮最长时间（分钟）', 'roundTimeoutMinutes', 'number')),
          h('p', { className: 'muted' }, '修改后先保存。活动时段只限制自动运行；立即运行和手动读视频仍受每日额度限制。分析失败或缺字幕也计入次数。'),
          h('p', { className: 'muted' }, '暂停会保存当前结果并阻止下一条。修改浏览设置会结束本轮剩余候选；自主选片的人设变化也会结束剩余候选。保存无关设置不重置浏览排期。修改时区不重置当前额度，过渡统计期可能延长。'),
          budget && h('p', { className: 'muted' }, '当前统计时区：', budget.zone, ' · 下次额度更新：', dateText(budget.end))),
          button('保存浏览设置', 'configure', { config: { ...config, keywords: (config.keywords || []).filter(k => k.trim()) } },
            !!active || installing || !!browsing?.busy, true)),
        ),
        h('section', { id: 'bili-tab-interaction', hidden: tab !== 'interaction' }, h('h3', null, '评论与@'),
          h('div', { id: 'bili-owner-mention-banner', className: 'setting-group' },
            h('h4', null, '使用者@大肥鱼'),
            h('p', { className: 'muted' }, ownerAccountReady
              ? '使用“关系”页保存的使用者账号；@目标是插件当前登录账号。读最近20条“@我的”通知，每次最多核对3条原评论，不读取使用者浏览历史。'
              : '需先在“关系”页设置并启用使用者账号，才能接收使用者@。'),
            h('p', { className: status.config.ownerCommentReplyEnabled ? 'muted' : 'notice' },
              status.config.ownerCommentReplyEnabled ? '当前状态：已开启。' : '当前状态：未开启 —— 被@时不会生成回复。'),
            h('div', { className: 'row' },
              !status.config.ownerCommentReplyEnabled && button('开启使用者@回复', 'configure',
                { config: { ownerCommentReplyEnabled: true } }, sendingBlocked || !ownerAccountReady),
              button('检查使用者@通知', 'owner_mentions_scan', {}, !!ownerMentionBlocked),
              h('button', { type: 'button', onClick: () => { setInteractionPane('settings'); setInteractionSettingsPane('replies'); } },
                '去接话规则')),
            h('p', { className: 'muted', role: 'status' }, ownerMentionBlocked ||
              '可立即检查；普通留言与楼中楼各按互动次数上限判断，发送沿用评论模式与总额度。'),
            status.ownerMentions?.notice && h('p', { className: 'notice' + (status.ownerMentions.error ? ' error' : '') }, status.ownerMentions.notice)),
          comments && h('p', { className: 'muted' }, '今日发送尝试 ', comments.budget.attempts, '/', comments.budget.limit,
            ' · 提及 ', comments.budget.mentionAttempts, '/', comments.budget.mentionLimit,
            comments.accountUid ? ' · 统计账号 UID ' + comments.accountUid : ' · 读取视频后确定发送账号'),
          h('div', { className: 'row' }, button('暂停评论', 'pause_comments', {}, !!comments?.paused),
            button('继续评论', 'resume_comments', {}, !comments?.paused)),
          inline('comments'),
          comments?.busy && h('p', { className: 'notice' }, '正在处理评论发布或核对，状态会自动更新。'),
          comments?.notice && h('div', { className: 'notice' + (comments.error ? ' error' : '') }, comments.notice, recoveryLink(comments.notice, comments.recoveryBvid)),
          h('div', { id: 'bili-interaction-settings' },
            h('nav', { className: 'subtabs', role: 'tablist', 'aria-label': '互动设置分类' },
              ...[['send', '发送与隐私'], ['replies', '接话规则'], ['mentions', '@对象']].map(([id, label]) =>
                h('button', { key: id, role: 'tab', 'aria-selected': interactionSettingsPane === id,
                  'aria-controls': 'bili-interaction-settings-' + id, onClick: () => setInteractionSettingsPane(id) }, label))),
            h('div', { id: 'bili-interaction-settings-send', hidden: interactionSettingsPane !== 'send' },
              h('div', { className: 'setting-group' }, h('h4', null, '发表评论方式'),
                h('div', { role: 'radiogroup', 'aria-label': '发表评论方式' },
                  h('div', { className: 'comment-mode-options' }, ...commentModes.map((mode, i) => h('button', {
                    key: mode.value, type: 'button', role: 'radio', value: mode.value, disabled: sendingBlocked,
                    'aria-checked': config.commentMode === mode.value, tabIndex: config.commentMode === mode.value ? 0 : -1,
                    onClick: () => setConfig({ ...config, commentMode: mode.value }),
                    onKeyDown: e => {
                      const next = e.key === 'Home' ? 0 : e.key === 'End' ? 2 : ['ArrowRight', 'ArrowDown'].includes(e.key) ? (i + 1) % 3 : ['ArrowLeft', 'ArrowUp'].includes(e.key) ? (i + 2) % 3 : null;
                      if (next === null || sendingBlocked) return;
                      e.preventDefault(); setConfig({ ...config, commentMode: commentModes[next].value });
                      e.currentTarget.parentElement.querySelectorAll('button')[next].focus();
                    },
                  }, mode.label))),
                h('p', { className: 'muted' }, commentModes.find(m => m.value === config.commentMode)?.description,
                  config.commentMode !== status.config.commentMode ? ' 选择尚未保存。' : ' 已保存。'))),
              h('div', { className: 'setting-group' }, h('h4', null, '公开评论的隐私检查'),
                h('div', { role: 'radiogroup', 'aria-label': '公开评论的隐私检查' },
                  h('div', { className: 'privacy-mode-options' }, ...[
                    { value: 'content', label: '按本条内容检查' }, { value: 'strict', label: '逐条隐私审核' },
                  ].map((mode, i, options) => h('button', { key: mode.value, type: 'button', role: 'radio', value: mode.value,
                    disabled: sendingBlocked, 'aria-checked': config.commentPrivacyMode === mode.value,
                    tabIndex: config.commentPrivacyMode === mode.value ? 0 : -1,
                    onClick: () => setConfig({ ...config, commentPrivacyMode: mode.value }),
                    onKeyDown: e => {
                      const next = e.key === 'Home' ? 0 : e.key === 'End' ? 1 : ['ArrowRight', 'ArrowDown'].includes(e.key) ? (i + 1) % 2 : ['ArrowLeft', 'ArrowUp'].includes(e.key) ? (i + 1) % 2 : null;
                      if (next === null || sendingBlocked) return;
                      e.preventDefault(); setConfig({ ...config, commentPrivacyMode: options[next].value });
                      e.currentTarget.parentElement.querySelectorAll('button')[next].focus();
                    },
                  }, mode.label))),
                h('p', { className: 'muted' }, config.commentPrivacyMode === 'content'
                  ? '不因同一对话处理过私信而一概拦截公开评论；仍检查凭据、联系方式、使用者身份、已知私信原文和自定义隐私词。无法保证识别所有改写或语义泄露。'
                  : '默认策略。若原对话处理过私信，每条公开评论都需在发送前人工核对；自动评论会等待审核。'),
                h('p', { className: 'muted' }, '只影响公开视频评论；周动态与跨联系人私信仍按各自的隐私审核规则处理。',
                  config.commentPrivacyMode !== status.config.commentPrivacyMode ? ' 选择尚未保存。' : ' 已保存。'))),
              h('div', { className: 'setting-group' }, h('h4', null, '次数与冷却'),
                h('div', { className: 'two' }, field('每天最多评论尝试（0关闭）', 'dailyCommentLimit', 'number'),
                  field('每轮主动评论尝试（0关闭主动评论）', 'perRoundCommentLimit', 'number')),
                field('评论最短间隔（秒，至少60）', 'commentMinIntervalSeconds', 'number'),
                h('p', { className: 'muted' }, '提及人次与冷却在“@对象”页设置。自动模式仅处理保存后新生成的草稿，遵守活动时段、暂停、额度、冷却与防重。开始发送即计数，结果不明也保留次数。')),
              h('div', { className: 'settings-toolbar' }, h('h4', null, '保存以上设置'),
                button('保存发送与隐私', 'configure', { config: { commentMode: config.commentMode, commentPrivacyMode: config.commentPrivacyMode,
                  dailyCommentLimit: config.dailyCommentLimit, perRoundCommentLimit: config.perRoundCommentLimit,
                  commentMinIntervalSeconds: config.commentMinIntervalSeconds } }, sendingBlocked, true))),
            h('div', { id: 'bili-interaction-settings-replies', hidden: interactionSettingsPane !== 'replies' },
              h('div', { className: 'setting-group', id: 'bili-self-reply-controls' },
                h('h4', null, '直接回复检查'),
                h('p', null, status.selfReplies?.enabled ? '直接回复检查已开启，沿用浏览活动时段。' : '直接回复检查未开启。'),
                h('p', { className: 'muted' }, '包括大肥鱼通过关键词互动发出的回复；别人直接回复它时即可触发。同楼其他人互相聊天不触发。'),
                h('div', { className: 'row' },
                  !status.selfReplies?.enabled && button('开启直接回复检查', 'configure', { config: { selfCommentReplyEnabled: true } }, sendingBlocked, true),
                  button('检查自己评论的回复', 'self_replies_scan', {}, !!selfReplyBlocked)),
                h('p', { className: 'muted', role: 'status' }, selfReplyBlocked || '可立即检查；每次最多判断/接话 ' + status.config.interactionSubLimit + ' 条，发送沿用评论模式与总额度。'),
                status.selfReplies?.notice && h('p', { className: 'notice' }, status.selfReplies.notice)),
              h('div', { className: 'setting-group' }, h('h4', null, '普通留言与楼中楼'),
                h('div', { className: 'two' }, field('普通留言上限（每次，0关闭）', 'interactionTopLimit', 'number'),
                  field('楼中楼上限（每次，0关闭）', 'interactionSubLimit', 'number')),
                h('p', { className: 'muted' }, '每次浏览、使用者@通知或自己评论回复检查的上限。关键词只用于普通留言；别人直接回复大肥鱼时无需关键词。今日判断 ',
                  status.interactions?.budget?.evaluations || 0, '/', status.interactions?.budget?.limit ?? status.config.dailyInteractionEvaluationLimit, '。')),
              h('div', { className: 'setting-group' }, h('h4', null, '触发与检查频率'),
                h('label', null, h('span', null, '关键词互动（每行一个，留空关闭）'),
                  h('textarea', { rows: 2, value: (config.interactionKeywords || []).join('\n'), placeholder: '例如：鱼来', disabled: sendingBlocked,
                    onChange: e => setConfig({ ...config, interactionKeywords: e.target.value.split(/\r?\n/) }) })),
                checkbox('别人直接回复大肥鱼已发评论时接话（默认关闭）', 'selfCommentReplyEnabled'),
                field('直接回复检查间隔（秒，60～3600）', 'selfReplyPollSeconds', 'number'),
                checkbox('使用者在视频评论区@大肥鱼时回应（默认关闭）', 'ownerCommentReplyEnabled'),
                h('p', { className: 'muted' }, '此项与其他设置一起保存后生效；只想先打开它，可用「评论与@」页顶部的一键开启。当前',
                  status.config.ownerCommentReplyEnabled ? '已开启' : '未开启', '。'),
                field('@通知检查间隔（秒，60～3600）', 'ownerMentionPollSeconds', 'number'),
                h('p', { className: 'muted' }, '关键词只找浏览视频中的普通留言；对方直接回复自己的评论、使用者@通知各自独立触发。三类入口共用互动判断额度、评论发送模式、每日评论额度、冷却、暂停与防重。')),
              h('div', { className: 'setting-group' }, h('h4', null, '互动判断额度'),
                h('div', { className: 'two' }, field('每天最多互动判断次数（0关闭）', 'dailyInteractionEvaluationLimit', 'number'),
                  h('p', { className: 'muted' }, '已保存：普通留言 ', status.config.interactionTopLimit, ' · 楼中楼 ', status.config.interactionSubLimit,
                    status.interactions?.budget ? ' · 今日判断 ' + status.interactions.budget.evaluations + '/' + status.interactions.budget.limit : '')),
                h('p', { className: 'muted' }, config.ownerAccountEnabled && config.ownerAccountUid ? '使用“关系”页保存的使用者账号；@目标是插件当前登录账号。检查最近20条“@我的”通知，最多核对3条原评论。' : '使用者@回复需先在“关系”页设置并启用使用者账号。直接回复轮流检查最近20条本人评论中的一条、每条最多读取前20条回复，不能保证覆盖全部。'),
                status.ownerMentions?.notice && h('p', { className: 'notice' + (status.ownerMentions.error ? ' error' : '') }, status.ownerMentions.notice),
                h('div', { className: 'row' }, button('检查使用者@通知', 'owner_mentions_scan', {}, sendingBlocked || !status.ownerMentions?.enabled || !!browsing?.round),
                  button('检查自己评论的回复', 'self_replies_scan', {}, !!selfReplyBlocked)),
                h('p', { className: 'muted' }, selfReplyBlocked || '直接回复检查沿用浏览活动时段；预览与逐条确认不会自动发送，自动模式仍可决定不回复。')),
              h('div', { className: 'settings-toolbar' }, h('h4', null, '保存以上设置'),
                button('保存接话规则', 'configure', { config: { interactionTopLimit: config.interactionTopLimit, interactionSubLimit: config.interactionSubLimit,
                  interactionKeywords: (config.interactionKeywords || []).map(k => k.trim()).filter(Boolean), selfCommentReplyEnabled: config.selfCommentReplyEnabled,
                  selfReplyPollSeconds: config.selfReplyPollSeconds, ownerCommentReplyEnabled: config.ownerCommentReplyEnabled,
                  ownerMentionPollSeconds: config.ownerMentionPollSeconds, dailyInteractionEvaluationLimit: config.dailyInteractionEvaluationLimit } }, sendingBlocked, true))),
            h('div', { id: 'bili-interaction-settings-mentions', hidden: interactionSettingsPane !== 'mentions' },
              h('div', { className: 'setting-group' }, h('h4', null, '评论提及规则'), checkbox('允许评论@指定账号', 'commentMentionsEnabled'),
                h('div', { className: 'two' }, field('每天最多提及人次（0关闭）', 'dailyMentionLimit', 'number'),
                  field('单条最多提及人数（0～3）', 'mentionsPerComment', 'number')),
                field('同一账号最短提及间隔（秒，至少60）', 'mentionMinIntervalSeconds', 'number'),
                h('p', { className: 'muted' }, '按人数计数；发送对象必须已启用评论提及且平台允许@。更改名单后先更新最终预览。')),
              h('div', { className: 'setting-group' }, h('h4', null, '指定提及对象'),
                h('p', { className: 'muted' }, '按UID解析真实昵称后加入。名单操作立即保存；动态提及也使用此名单。'),
                h('label', null, h('span', null, '提及对象 UID 或 B站主页链接'), h('input', { value: mentionInput, disabled: sendingBlocked,
                  onChange: e => setMentionInput(e.target.value) })),
                button('解析并加入名单', 'add_mention', { uid: mentionInput }, sendingBlocked || !mentionInput.trim()),
                ...(config.mentionTargets || []).map(t => h('div', { className: 'contact-line', key: t.uid },
                  h('a', { href: 'https://space.bilibili.com/' + t.uid, target: '_blank', rel: 'noopener noreferrer' }, t.name + ' · UID ' + t.uid),
                  h('div', { className: 'row' },
                    button(t.enabled ? '停用' : '启用', 'change_mention', { uid: t.uid, enabled: !t.enabled, allowComment: t.allowComment }, sendingBlocked),
                    button(t.allowComment ? '关闭评论提及' : '允许评论提及', 'change_mention', { uid: t.uid, enabled: t.enabled, allowComment: !t.allowComment }, sendingBlocked),
                    button(t.allowDynamic ? '关闭动态提及' : '允许动态提及', 'change_mention', { uid: t.uid, enabled: t.enabled, allowComment: t.allowComment, allowDynamic: !t.allowDynamic }, sendingBlocked),
                    button('移除', 'remove_mention', { uid: t.uid }, sendingBlocked))))),
              h('div', { className: 'settings-toolbar' }, h('h4', null, '保存以上设置'),
                button('保存@对象设置', 'configure', { config: { commentMentionsEnabled: config.commentMentionsEnabled,
                  dailyMentionLimit: config.dailyMentionLimit, mentionsPerComment: config.mentionsPerComment,
                  mentionMinIntervalSeconds: config.mentionMinIntervalSeconds } }, sendingBlocked, true))),
          ),
          ),
        h('details', { hidden: tab !== 'browse' }, h('summary', null, '内容理解设置'),
          h('p', { className: 'muted' }, 'ASMR、助眠等声音类视频自动参考评论区生成概述，记录中可查看原文样本；不代表实际收听。有效评论不足时跳过。'),
          h('label', { className: 'row' }, h('input', { type: 'checkbox', checked: !!config.asrEnabled,
            disabled: busy || !!active || installing, onChange: e => setConfig({ ...config, asrEnabled: e.target.checked }) }),
          '无字幕时转写讲话（本机）'),
          h('details', null, h('summary', null, '音频预算'),
            h('div', { className: 'two' }, field('单视频最多转写秒数（0关闭）', 'asrMaxSeconds', 'number'),
              field('每日最多音频秒数（0关闭）', 'dailyAudioSeconds', 'number')),
            field('每日最多转写请求数（0关闭）', 'dailyAudioRequests', 'number')),
          status.audio?.budget && h('p', { className: 'muted' }, '今日音频预留：', status.audio.budget.reservedSeconds,
            '/', status.audio.budget.secondsLimit, '秒 · 请求 ', status.audio.budget.requests, '/', status.audio.budget.requestLimit),
          h('p', { className: 'muted' }, '模型目录与依赖在“高级”准备。讲话转写从开头处理到时长上限，失败仍计占额；声音类视频使用评论区，不占音频额度。'),
          h('label', { className: 'row' }, h('input', { type: 'checkbox', checked: !!config.visionEnabled,
            disabled: busy || !!active || installing, onChange: e => setConfig({ ...config, visionEnabled: e.target.checked }) }),
          '结合画面与字幕理解视频（抽帧识别）'),
          h('details', null, h('summary', null, '画面抽帧预算'),
            h('div', { className: 'two' }, field('每个视频抽几帧（1～24）', 'visionFramesPerVideo', 'number'),
              field('抽帧超时秒数（30～1800）', 'visionTimeoutSeconds', 'number')),
            h('div', { className: 'two' }, field('每日最多抽帧次数（0关闭）', 'dailyVisionRequests', 'number'),
              field('每日最多总帧数（0关闭）', 'dailyVisionFrames', 'number'))),
          status.frames?.budget && h('p', { className: 'muted' }, '今日画面预留：', status.frames.budget.reservedFrames,
            '/', status.frames.budget.framesLimit, '帧 · 请求 ', status.frames.budget.requests, '/', status.frames.budget.requestLimit),
          h('p', { className: 'muted' }, '开启后按秒均匀抽帧，并同时提供可用字幕，结合画面与文本理解。没有字幕时只看实际画面，不编造台词；抽帧失败会退回文本并显示原因。只评价覆盖时段，不评价未读取的声音。不需要外部 ffmpeg。'),
          h('div', { className: 'row' },
            button('检查画面环境', 'vision_check', {}, busy || installing || !!active),
            button('清理画面缓存', 'vision_cleanup', {}, busy || installing || !!active),
            inline('frames')),
          button('保存内容理解设置', 'configure', { config: { ...config, keywords: (config.keywords || []).filter(k => k.trim()) } },
            !!active || installing || !!browsing?.busy, true)),
        h('section', { id: 'bili-manual-read', hidden: tab !== 'browse' }, h('h3', null, '手动读一个视频'),
          h('label', null, h('span', null, 'BV 号或完整视频链接'),
            h('input', { value: bvid, placeholder: 'BV… 或 https://www.bilibili.com/video/BV…',
              onChange: e => setBvid(e.target.value), disabled: busy || !!active })),
          button('读取并生成评价', 'analyze', { bvid, requestId: crypto.randomUUID() },
            binding.phase !== 'active' || !!active || installing || !bvid.trim(), true),
          inline('video'),
          h('p', { className: 'muted' }, '声音类视频参考评论区；其他视频读取字幕，可选讲话转写。评论模式和关键词回复在“互动”页设置。'),
          binding.phase !== 'active' && h('p', { className: 'notice' }, '请先在“高级”中完成工作区绑定与登录。'),
          binding.phase === 'active' && h('button', { onClick: () => { openSession(binding.sessionId); close?.(); } }, '打开汇总对话'),
          active && h('div', { className: 'notice' },
            h('p', null, states[active.state], ' · ', active.bvid || (active.kind === 'weekly' ? '周总结动态' : ['dm', 'dm_proactive'].includes(active.kind) ? '私信生成' : '接入检查')),
            h('p', null, active.waitReason || '任务已保存；可打开原对话查看进度。'),
            h('div', { className: 'row' },
              button('核对原对话结果', 'reconcile', { requestId: active.id }, active.state === 'reading'),
              button('解除本地等待', 'release', { requestId: active.id }, active.state !== 'awaiting_model' || binding.running)),
            h('p', { className: 'muted' }, '解除等待只适用于原对话已停止的任务，之后仍可核对原结果。'))),
        h('section', { id: 'bili-tab-history', hidden: tab !== 'history' }, h('h3', null, '记录'),
          h('nav', { className: 'subtabs record-tabs', role: 'tablist', 'aria-label': '记录分区' },
            ...[['browse', '浏览记录'], ['interactions', '互动记录'], ['published', '已发评论'], ['pending', '待处理']].map(([id, label]) =>
              h('button', { key: id, role: 'tab', 'aria-selected': recordPane === id, 'aria-controls': id === 'browse' ? 'bili-history-browse' : id === 'interactions' ? 'bili-history-interactions' : id === 'published' ? 'bili-published-comments' : 'bili-history-pending',
                onClick: () => setRecordPane(id) }, label))),
          status.history?.pending?.manual > 0 && h('div', { className: 'record-attention', role: 'status' },
            h('span', null, '有 ', status.history.pending.manual, ' 条需要人工处理'),
            h('button', { type: 'button', disabled: busy, onClick: () => changePendingView({ filter: 'manual', offset: 0 }) }, '查看待处理条目')),
          status.record && h('div', { id: 'bili-focused-record', className: 'record-focus' },
            h('div', { className: 'row' }, h('strong', null, '选中的记录'),
              h('button', { type: 'button', onClick: () => { focusedRecord.current = ''; setStatus(before => ({ ...before, record: null })); } }, '关闭详情')),
            renderRunDetails(status.record, true)),
          renderPublished(),
          h('div', { id: 'bili-history-interactions', className: 'record-panel', hidden: recordPane !== 'interactions' },
            h('h4', null, '互动记录 · ', interactionRecords?.total || 0, ' 条'),
            h('p', { className: 'muted' }, '关键词回复、楼中楼接话与使用者@触发的回复都在这里。自动与手动模式都会显示；需人工处理的草稿见“待处理”。'),
            h('nav', { className: 'subtabs', role: 'tablist', 'aria-label': '互动记录类型' },
              ...[['all', '全部'], ['top', '普通留言'], ['sub', '楼中楼']].map(([value, label]) => h('button', { type: 'button', key: value,
                role: 'tab', 'aria-selected': (interactionRecords?.level || 'all') === value, disabled: busy,
                onClick: () => changeInteractionView({ level: value, offset: 0 }) }, label,
                interactionRecords && value !== 'all' ? ' ' + interactionRecords.counts[value] : ''))),
            h('div', { className: 'interaction-records' },
              ...(interactionRecords?.rows || []).map(r => h('details', { key: r.id, className: 'interaction-result' },
                h('summary', null, h('span', { className: 'kind-badge' + (r.target?.level === 'sub' ? ' sub' : '') }, r.target?.level === 'sub' ? '楼中楼' : '普通留言'),
                  r.state === 'declined' ? '不准备回复' : commentStates[r.state] || states[r.state] || r.state, ' · ', dateText(r.at)),
                h('p', { className: 'muted' }, r.trigger === 'self_reply' ? '对自己评论的直接回复' : r.trigger === 'owner_mention' ? '使用者@触发' : '普通评论关键词触发', ' · ', r.bvid),
                h('p', { className: 'message-label' }, '对方原留言'), h('blockquote', { className: r.target?.level === 'sub' ? 'sub-comment' : 'root-comment' }, r.target?.text),
                h('p', { className: 'message-label' }, '大肥鱼 · 回复'), h('blockquote', { className: 'self-comment' }, r.text || '无回复草稿。'),
                r.reason && h('p', { className: 'muted' }, r.reason),
                h('div', { className: 'row' },
                  h('a', { href: 'https://www.bilibili.com/video/' + r.bvid + '/#reply' + r.target?.id, target: '_blank', rel: 'noopener noreferrer' }, '查看原留言'),
                  h('button', { type: 'button', disabled: busy, onClick: () => openRecord(r.id) }, '查看评价与发送详情')))),
              !interactionRecords?.rows?.length && h('p', { className: 'dm-empty' }, '暂无此类互动记录。')),
            interactionRecords && h('div', { className: 'row' },
              h('button', { disabled: busy || !interactionRecords.offset, onClick: () => changeInteractionView({ offset: Math.max(0, interactionRecords.offset - interactionRecords.pageSize) }) }, '上一页互动'),
              h('span', { className: 'muted' }, rangeText(interactionRecords.offset, interactionRecords.pageSize, interactionRecords.total)),
              h('button', { disabled: busy || interactionRecords.offset + interactionRecords.pageSize >= interactionRecords.total,
                onClick: () => changeInteractionView({ offset: interactionRecords.offset + interactionRecords.pageSize }) }, '下一页互动')),
            status.interactions?.notice && h('p', { className: 'notice' + (status.interactions.error ? ' error' : '') }, status.interactions.notice)),
          renderPending(),
          h('div', { id: 'bili-history-browse', className: 'record-panel', hidden: recordPane !== 'browse' },
            h('h4', null, '浏览记录'),
browsing?.recentRounds?.length > 0 && h('details', null, h('summary', null, '最近浏览轮次'),
            ...browsing.recentRounds.map(round => h('div', { key: round.id }, h('p', null, dateText(round.createdAt), ' · ', round.keyword,
              round.tagFilter ? ' · TAG' : '', ' · ', roundStates[round.state], ' · 启动 ', round.analysisIds.length, ' 条 · ', round.reason || round.error?.message || '',
              round.tagSearchStats ? ' · TAG核对' + round.tagSearchStats.checked + '个，匹配' + round.tagSearchStats.matched + '，不匹配' + round.tagSearchStats.mismatched + '，未核实' + round.tagSearchStats.unverified : ''), choiceDetails(round)))),
          h('details', null, h('summary', null, '筛选与批量清理'),
            h('label', null, h('span', null, '搜索标题、BV或摘要'), h('input', { value: historyFilters?.q || '', maxLength: 100, disabled: busy,
              onChange: e => setHistoryFilters({ ...historyFilters, q: e.target.value }) })),
            h('div', { className: 'two' }, ...[
              ['kind', '记录类型', [['video', '视频'], ['probe', '接入检查']]],
              ['source', '理解来源', [['all', '全部来源'], ['subtitle', '字幕'], ['asr', '讲话转写'], ['frames', '画面抽帧'], ['comments', '评论区概述'], ['interaction', '关键词留言']]],
              ['state', '记录状态', [['all', '全部状态'], ['preview', '评价已完成'], ['skipped', '已跳过'], ['failed', '失败'], ['interrupted', '中断'], ['completed', '检查完成'], ['needs_review', '待核对']]],
            ].map(([key, label, values]) => h('label', { key }, h('span', null, label), h('select', { value: historyFilters?.[key] || 'all', disabled: busy,
              onChange: e => setHistoryFilters({ ...historyFilters, [key]: e.target.value }) }, ...values.map(([value, name]) => h('option', { key: value, value }, name))))),
              ...[['from', '开始日期'], ['to', '结束日期']].map(([key, label]) => h('label', { key }, h('span', null, label + '（' + status.config.timeZone + '）'),
                h('input', { type: 'date', value: historyFilters?.[key] || '', disabled: busy, onChange: e => setHistoryFilters({ ...historyFilters, [key]: e.target.value }) })))),
            h('div', { className: 'row' }, h('button', { disabled: busy, onClick: () => {
              historyQuery.current = { ...historyFilters }; page.current = 0; setOffset(0); setHistoryDelete(null); act('status'); } }, '应用筛选'),
              h('button', { disabled: busy, onClick: () => { historyQuery.current = { kind: 'video' }; setHistoryFilters({ kind: 'video' }); page.current = 0; setOffset(0); setHistoryDelete(null); act('status'); } }, '清除筛选'),
              button('预览本次批量清理', 'history_preview_delete', { filters: historyQuery.current }, sendingBlocked)),
            historyDelete && h('div', { className: 'notice' }, h('p', null, '即将清理 ', historyDelete.count, ' 条已结束记录。', historyDelete.more ? '其余记录留待下一批。' : ''),
              ...historyDelete.sample.map((r, i) => h('p', { key: i }, r.title, ' · ', dateText(r.createdAt))),
              h('details', null, h('summary', null, '查看完整待清理清单'), h('div', { style: { maxHeight: '30vh', overflowY: 'auto' } },
                ...(historyDelete.records || []).map(r => h('p', { key: r.id }, r.title, ' · ', dateText(r.createdAt), ' · ', h('code', null, r.id))))),
              button('确认清理这批记录与笔记', 'history_confirm_delete', { token: historyDelete.token, confirmed: true }, sendingBlocked),
              h('button', { disabled: busy, onClick: () => setHistoryDelete(null) }, '取消批量清理')),
            h('p', { className: 'muted' }, '只清理预览中的记录和本插件笔记，最多100条；原对话、计数、发送去重及独立学习记忆保留。')),
          inline('history'),
          status.history && h('p', { className: 'muted' }, '匹配 ', status.total, ' / 全部 ', status.history.totalAll, ' 条'),
          status.history?.notice && h('p', { className: 'notice' }, status.history.notice),
          status.history?.pendingNotes > 0 && button('重试清理剩余笔记', 'history_retry_notes', {}, sendingBlocked),
          h('div', { className: 'row', 'aria-label': '评论类别图例' },
            h('span', { className: 'badge self-comment' }, '蓝色 · 大肥鱼'), h('span', { className: 'badge root-comment' }, '绿色 · 检索普通留言'),
            h('span', { className: 'badge sub-comment' }, '紫色 · 楼中楼')),
          h('div', { className: 'row' }, button('补全当前页封面', 'refresh_covers', { offset, filters: historyQuery.current },
            !!active || installing || !!browsing?.busy || !!browsing?.round || status.covers?.state === 'running'),
            h('span', { className: 'muted' }, '只读取视频资料，不重新分析。')),
          inline('covers'),
          inline('comments'),
          comments?.busy && h('p', { className: 'notice' }, '正在处理评论发布或核对，状态会自动更新。'),
          comments?.notice && h('div', { className: 'notice' + (comments.error ? ' error' : '') }, comments.notice, recoveryLink(comments.notice, comments.recoveryBvid)),
          button('整理数据库空间', 'compact_database', {}, !!active || installing || !!social?.busy || !!browsing?.busy || !!browsing?.round),
          h('p', { className: 'muted' }, '删除会清理记录、对应笔记及本地评论文案，不撤回已发表内容。原对话消息、计数和防重标识保留；结果不明时请先核对，删除后到B站核对。随后可整理数据库空间。'),
          status.covers?.message && h('p', { className: 'muted' }, status.covers.message),
          status.covers?.error && h('p', { className: 'notice error' }, status.covers.error.message),
          status.runs.length === 0 && h('p', { className: 'muted' }, '暂无记录。完成一次读取后会在这里显示。'),
          ...status.runs.map(run => renderRunDetails(run)),
          h('div', { className: 'row' },
            h('button', { disabled: busy || offset === 0, onClick: () => {
              page.current = Math.max(0, offset - pageSize); setOffset(page.current); act('status'); } }, '上一页'),
            h('span', { className: 'muted' }, status.total ? (offset + 1) + '—' + Math.min(offset + pageSize, status.total) : '0'),
            h('button', { disabled: busy || offset + pageSize >= status.total, onClick: () => {
              page.current = offset + pageSize; setOffset(page.current); act('status'); } }, '下一页')))),
        (tab === 'advanced' || (tab === 'persona' && ['base', 'settings'].includes(personaView))) && h('div', { className: 'save' },
            button(tab === 'persona' && personaView === 'settings' ? '保存学习设置' : tab === 'persona' && personaView === 'base' ? '保存基础人设' : '保存设置', 'configure', {
              config: tab === 'persona' && personaView === 'base' ? Object.fromEntries(['persona', 'maxContentChars', 'commentMaxChars',
                'ownerAccountEnabled', 'ownerAccountUid', 'ownerAccountName', 'ownerAttitudeEnabled'].map(key => [key, config[key]])) :
                tab === 'persona' && personaView === 'settings' ? Object.fromEntries(['learningEnabled', 'learningFeedbackEnabled', 'learningCreativeIdeas',
                  'learningKnowledgePacks', 'learningDailyTime', 'learningDailyReport', 'learningReportDetail', 'learningDirectionSuggestions',
                  'learningAdvice', 'learningDailyReviewLimit'].map(key => [key, config[key]])) :
                  { ...config, keywords: (config.keywords || []).filter(k => k.trim()) } },
            sendingBlocked, true)));
    }
    return {
      request: api,
      inject: ['slots', 'uiWorkspace'],
      apply(ctx) {
        if (typeof document !== 'undefined' && typeof ctx.effect === 'function') ctx.effect(installNavIcon, 'bilibili-harness: navigation icon');
        const slots = ctx.get('slots');
        slots.inject('settings.section', () => slots.register({
          name: 'settings.section', id: 'bilibili-harness', order: 85, label: 'B站浏览',
        }, props => h(Panel, { ...props, openSession: id => ctx.get('uiWorkspace').openSession(id) })));
      },
    };
  },
});
