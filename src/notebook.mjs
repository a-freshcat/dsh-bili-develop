import { lstatSync, mkdirSync, realpathSync, writeFileSync, renameSync, existsSync, unlinkSync } from 'node:fs';
import { join, relative, isAbsolute } from 'node:path';
import { randomUUID } from 'node:crypto';
import { assert } from './errors.mjs';

export function writeLearning(root, account, text) { return writeLearningFile(root, account, text, 'learning'); }
export function writeIdeas(root, account, text) { return writeLearningFile(root, account, text, 'reflection-ideas'); }
function writeLearningFile(root, account, text, prefix) {
  assert(/^[1-9]\d{0,19}$/.test(account), 'INVALID_UID', '学习账号无效。');
  const base = realpathSync(root), directory = join(base, '.bilibili-harness');
  if (existsSync(directory)) assert(!lstatSync(directory).isSymbolicLink(), 'NOTE_PATH', '学习目录不能是符号链接。');
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const remainder = relative(base, realpathSync(directory));
  assert(!remainder.startsWith('..') && !isAbsolute(remainder), 'NOTE_PATH', '学习目录超出工作区。');
  const target = join(directory, prefix + '-' + account + '.md');
  if (existsSync(target)) assert(!lstatSync(target).isSymbolicLink(), 'NOTE_PATH', '学习文件不能是符号链接。');
  const temporary = join(directory, '.' + randomUUID() + '.tmp');
  writeFileSync(temporary, text, { encoding: 'utf8', mode: 0o600 }); renameSync(temporary, target);
  return relative(base, target);
}

export function noteForDeletion(root, run) {
  assert(/^[A-Za-z0-9_-]{8,100}$/.test(run.id), 'INVALID_REQUEST_ID', '笔记任务标识无效。');
  assert(existsSync(root), 'NOTE_PATH', '原工作区目录不可用，请恢复目录后再清理笔记。');
  assert(!lstatSync(root).isSymbolicLink(), 'NOTE_PATH', '原工作区目录已变成链接，请恢复后再清理。');
  const base = realpathSync(root);
  let directory = base;
  for (const component of ['.bilibili-harness', 'notes']) {
    directory = join(directory, component);
    if (!existsSync(directory)) return;
    assert(!lstatSync(directory).isSymbolicLink(), 'NOTE_PATH', '笔记目录不能是符号链接。');
    const remainder = relative(base, realpathSync(directory));
    assert(!remainder.startsWith('..') && !isAbsolute(remainder), 'NOTE_PATH', '笔记目录超出工作区。');
  }
  const target = join(directory, run.id + '.md');
  if (existsSync(target)) {
    assert(!lstatSync(target).isSymbolicLink() && lstatSync(target).isFile(), 'NOTE_PATH', '笔记文件不能是链接或目录。');
    return target;
  }
}
export function deleteNote(root, run) {
  const target = noteForDeletion(root, run);
  if (target) unlinkSync(target);
}

export function writeNote(root, run) {
  assert(/^[A-Za-z0-9_-]{8,100}$/.test(run.id), 'INVALID_REQUEST_ID', '笔记任务标识无效。');
  const base = realpathSync(root);
  let directory = base;
  for (const component of ['.bilibili-harness', 'notes']) {
    directory = join(directory, component);
    if (existsSync(directory)) assert(!lstatSync(directory).isSymbolicLink(),
      'NOTE_PATH', '插件笔记目录不能是符号链接。');
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const remainder = relative(base, realpathSync(directory));
    assert(!remainder.startsWith('..') && !isAbsolute(remainder), 'NOTE_PATH', '笔记目录超出指定工作区。');
  }
  const preview = run.preview;
  const community = run.evidence?.source === 'comments';
  const lines = [
    '# ' + (run.evidence?.title || (run.kind === 'probe' ? '单对话接入检查' : run.bvid)),
    '', '任务：' + run.id, '时间：' + run.createdAt, '状态：' + run.state,
    '唯一对话：' + run.sessionId, '',
    ...(run.source === 'owner_mention' ? ['来源：使用者@触发的视频阅读；不占自主浏览轮次或视频分析次数，受评论互动判断额度控制。', ''] : []),
    ...(run.browseSelection?.mode === 'autonomous' ? ['## 自主选片入口',
      '来自B站推荐候选；本轮想了解：' + run.browseSelection.intent,
      '选片理由：' + run.browseSelection.reason,
      '实际标签：' + run.browseSelection.tags.join('、'),
      '资料时间：' + run.browseSelection.checkedAt + '；选片理由基于简介与标签，不作为视频内容结论。', ''] : []),
    ...(run.browseSelection?.mode === 'tag' ? ['## TAG浏览入口',
      '检索TAG：' + run.browseSelection.query + '；匹配方式：' + run.browseSelection.match,
      '实际标签：' + run.browseSelection.tags.map(t => t.name + '（' + t.id + '）').join('、'),
      '核对时间：' + run.browseSelection.checkedAt + '；标签只代表分类，不能替代内容依据。', ''] : []),
    ...(run.interactionTarget ? ['## ' + (run.interactionTrigger === 'owner_mention' ? '使用者@原留言' : '命中的原留言'), '类别：' + (run.interactionTarget.level === 'sub' ? '楼中楼' : '普通留言'),
      '评论ID：' + run.interactionTarget.id + '；根评论：' + run.interactionTarget.root,
      run.interactionTarget.text, ''] : []),
    ...(run.interactionScan ? ['## 评论区关键词检索', run.interactionScan.message || '', ''] : []),
    ...(run.accountComment ? ['## 账号管理', '作品：'+run.accountComment.resource.title,
      '原内容：'+run.accountComment.resource.url,'原留言：'+run.accountComment.target.text,
      '处理状态：'+run.accountComment.state+'；'+run.accountComment.reason,''] : []),
    ...(run.bvid ? ['视频：https://www.bilibili.com/video/' + run.bvid,
      '依据：' + run.evidence.source + '；覆盖范围：' + run.evidence.coverage, ''] : []),
    ...(run.visionNotice ? ['画面理解未使用，已回退文本：' + run.visionNotice, ''] : []),
    ...(run.evidence?.source === 'frames' ? ['说明：按秒均匀抽帧，不代表完整视频或实际听过声音。' + (run.evidence.textSource ? '同时提供文本来源：' + run.evidence.textSource + '；文本覆盖：' + run.evidence.textCoverage + '。' : '没有可用字幕，不编造台词。'),
      '实际抽帧：' + (run.evidence.totalFrames || 0) + ' 帧；时间点（秒）：' +
        (run.evidence.frames || []).map(f => f.at).join('、'),
      '处理区间（秒）：' + (run.evidence.processedRanges || []).map(r => r.from + '–' + r.to).join('、') +
        '；本机用PyAV解码，未调用外部服务。', ''] : []),
    ...(community ? ['说明：以下是评论区样本转述，未播放或分析音频，不代表视频事实或全体观众。',
      '有效评论样本：' + run.evidence.commentSample.count + '；范围：整个视频评论区，非收听片段。',
      '已读排序：' + run.evidence.commentSample.orders.join('、') +
        (run.evidence.commentSample.failedOrders.length ? '；暂不可读：' + run.evidence.commentSample.failedOrders.join('、') : ''), ''] : []),
    ...(preview ? [community ? '## 评论区概述' : '## 摘要', preview.summary, '', '## 评价', preview.evaluation, '',
      ({ sent: '## 评论平台记录（公开展示另行核对）', unknown: '## 评论发送结果待核对', sending: '## 评论发送处理中', failed: '## 评论发送未完成' })[run.commentPublication?.state] || '## 评论预览（未发送）', run.commentPublication?.text || preview.comment || '本次不准备评论。', '',
      ...(run.commentPublication ? ['评论状态：' + run.commentPublication.state + '；' + (run.commentPublication.reason || ''),
        ...(run.commentPublication.state === 'sent' ? ['说明：平台回执、本人接口或评论定位可读，不代表其他账号的公开列表可见，也不证明提及通知送达。'] : []),
        ...(run.commentPublication.publicList ? ['未登录最新样本核对：' + run.commentPublication.publicList.state +
          '；样本数：' + (run.commentPublication.publicList.sampleCount ?? '未知') + '；时间：' +
          (run.commentPublication.publicList.checkedAt ? new Date(run.commentPublication.publicList.checkedAt).toISOString() : '未检查') +
          '。仅表示当次最多20条样本，公开可见性未确认时不重发。'] : []),
        ...(run.commentPublication.platformFeedback ? ['平台回执提示：' + (run.commentPublication.platformFeedback.toast || '未返回额外文字提示') +
          '；验证码要求：' + (run.commentPublication.platformFeedback.needCaptcha ?? '未知') +
          '；平台评论状态值：' + (run.commentPublication.platformFeedback.replyState ?? '未知') +
          '；平台不可见标记：' + (run.commentPublication.platformFeedback.invisible ?? '未知') + '。这些字段不能单独证明公开展示。'] : []),
        ...(run.commentPublication.receiptCandidate && !run.commentPublication.receipt ? ['平台候选评论编号：' + run.commentPublication.receiptCandidate + '；尚待核对，不代表已公开。'] : []),
        '提及对象：' + run.commentPublication.mentions.map(t => t.name + '（UID ' + t.uid + '）').join('、'),
        ...(run.commentPublication.receipt ? ['评论链接：https://www.bilibili.com/video/' + run.bvid + '/#reply' + run.commentPublication.receipt] : []), ''] : []),
      '判断说明：' + preview.reason, '原文依据：' + preview.evidence_quote,
      ...(run.evidence?.processedRanges ? ['', '实际处理区间（秒）：' + run.evidence.processedRanges.map(r => r.from + '–' + r.to).join('、')] : [])] :
      [run.skipReason || run.probeResult || '本次没有可用的预览结果。']),
    ...(community && run.evidence.comments.length ? ['', '## 已读评论样本',
      ...run.evidence.comments.flatMap(row => [
        '> ' + row.text.replace(/([\[\]<>])/g, '\\$1').replace(/\n/g, '\n> '),
        `[查看评论](${row.url}) · ${row.order === 'hot' ? '热评' : '最新评论'} · ${row.likes}赞` + (row.truncated ? ' · 已截短' : ''), '',
      ])] : []),
    ...(run.evidence?.discussion ? ['', '## 关联讨论样本（非完整评论区）',
      '已读：' + run.evidence.discussion.count + '条；不可读排序：' + (run.evidence.discussion.failedOrders.join('、') || '无'),
      ...run.evidence.discussion.comments.flatMap(row => ['> ' + row.text.replace(/([\[\]<>])/g, '\\$1').replace(/\n/g, '\n> '),
        '[查看评论](' + row.url + ') · ' + ({ thread: '关联楼层', hot: '热评', recent: '最新评论' })[row.order], ''])] : []),
    '',
  ];
  const target = join(directory, run.id + '.md');
  const temporary = join(directory, '.' + randomUUID() + '.tmp');
  writeFileSync(temporary, lines.join('\n'), { encoding: 'utf8', mode: 0o600 });
  renameSync(temporary, target);
  return relative(base, target);
}
