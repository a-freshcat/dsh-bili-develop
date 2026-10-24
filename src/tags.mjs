import { assert } from './errors.mjs';

export const normalTag = text => text.normalize('NFKC').trim().toLowerCase();
export function tagSelection(video, filter, query, now) {
  assert(Array.isArray(video.tags) && video.tags.length <= 50 && video.tags.every(t => t &&
    typeof t.id === 'string' && /^[1-9]\d{0,19}$/.test(t.id) && typeof t.name === 'string' &&
    t.name.trim() && t.name.length <= 80 && !/[\r\n\0]/.test(t.name)), 'TAG_RESULT', '搜索没有返回可核对的实际视频TAG；不会按标题放行。');
  const names = new Set(video.tags.map(t => normalTag(t.name)));
  const required = filter.tags.map(normalTag);
  assert(filter.match === 'all' ? required.every(t => names.has(t)) : required.some(t => names.has(t)),
    'TAG_RESULT', '候选视频实际标签未满足当前TAG限制；未启动分析。');
  return { mode: 'tag', query, requiredTags: [...filter.tags], match: filter.match,
    tags: video.tags.map(({ id, name }) => ({ id, name })), checkedAt: new Date(now).toISOString() };
}
