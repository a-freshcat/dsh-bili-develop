import { assert } from './errors.mjs';

// The sample is community testimony about a whole video, never an audio observation.
export function validateCommentEvidence(evidence, run, config) {
  if (evidence.source !== 'comments') return;
  const valid = (condition, message) => assert(condition, 'INVALID_EVIDENCE', message);
  const sample = evidence.commentSample;
  valid(evidence.classification?.kind === 'asmr' && ['title', 'tag'].includes(evidence.classification.matchedBy) &&
    typeof evidence.classification.term === 'string' && evidence.classification.term.length <= 20,
  '评论区读取缺少有效的声音类视频识别依据。');
  valid(Array.isArray(evidence.comments) && evidence.comments.length <= 20 && sample?.count === evidence.comments.length &&
    sample.limit === 20 && Number.isInteger(sample.maxChars) && sample.maxChars >= 1000 && sample.maxChars <= Math.min(6000, config.maxContentChars) &&
    sample.scope === 'whole_video' && Array.isArray(sample.orders) && Array.isArray(sample.failedOrders) &&
    [...sample.orders, ...sample.failedOrders].every(order => ['hot', 'recent'].includes(order)),
  '评论区样本数量、来源或预算无效。');
  valid(Array.isArray(evidence.segments) && evidence.segments.length === 0 && !evidence.processedRanges &&
    evidence.coverage === (evidence.comments.length ? 'sampled' : 'none'), '评论区样本不能标记为已完整读取视频或音频。');
  const ids = new Set();
  for (const row of evidence.comments) {
    valid(typeof row.id === 'string' && /^[1-9][0-9]{0,29}$/.test(row.id) && !ids.has(row.id) &&
      typeof row.text === 'string' && row.text.trim().length >= 6 && row.text.length <= 500 &&
      sample.orders.includes(row.order) && row.url === `https://www.bilibili.com/video/${run.bvid}/#reply${row.id}` &&
      Number.isInteger(row.likes) && row.likes >= 0 && row.likes <= 2147483647 && typeof row.truncated === 'boolean',
    '评论区原文、链接或排序来源无效。');
    ids.add(row.id);
  }
  valid(evidence.text === evidence.comments.map(row => row.text).join('\n') && evidence.text.length <= sample.maxChars &&
    (evidence.comments.length >= 2 || typeof evidence.skipReason === 'string' && evidence.skipReason.trim()),
  '评论区正文与样本不一致，或有效评论不足。');
}
