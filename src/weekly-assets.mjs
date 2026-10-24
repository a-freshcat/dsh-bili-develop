import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, writeFileSync, renameSync, readdirSync, unlinkSync } from 'node:fs';
import { join, relative, isAbsolute } from 'node:path';
import { randomUUID } from 'node:crypto';
import { assert } from './errors.mjs';

export const digest = value => createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest('hex');
export function managed(root, components) {
  assert(!lstatSync(root).isSymbolicLink(), 'WEEKLY_PATH', '原资料根目录已变成链接，请恢复原目录。');
  const base = realpathSync(root); let path = base;
  for (const part of components) {
    assert(/^[A-Za-z0-9_.-]+$/.test(part) && part !== '.' && part !== '..', 'WEEKLY_PATH', '动态资料路径无效。');
    path = join(path, part);
    if (existsSync(path)) assert(!lstatSync(path).isSymbolicLink(), 'WEEKLY_PATH', '动态资料不能使用链接目录或文件。');
    else mkdirSync(path, { mode: 0o700 });
    const rest = relative(base, realpathSync(path));
    assert(!rest.startsWith('..') && !isAbsolute(rest), 'WEEKLY_PATH', '动态资料超出原工作区。');
  }
  return path;
}
export function readImage(workspace, image) {
  assert(image && /^[a-f0-9]{64}$/.test(image.hash) && image.mime === 'image/jpeg', 'WEEKLY_IMAGE', '配图标识无效。');
  const directory = managed(workspace, ['.bilibili-harness', 'weekly', 'images']);
  const path = join(directory, image.hash + '.jpg');
  assert(existsSync(path) && !lstatSync(path).isSymbolicLink() && lstatSync(path).isFile(), 'WEEKLY_IMAGE_CHANGED', '配图不存在或已变化，请重新选图并审核。');
  const size = lstatSync(path).size;
  assert(size > 0 && size <= 2 * 1024 * 1024 && size === image.size, 'WEEKLY_IMAGE_CHANGED', '配图大小已变化，请重新选图并审核。');
  const bytes = readFileSync(path);
  assert(digest(bytes) === image.hash, 'WEEKLY_IMAGE_CHANGED', '配图内容已变化，请重新选图并审核。');
  return bytes;
}
export function adoptImage(dataDir, workspace, value) {
  assert(value && /^[a-f0-9]{64}$/.test(value.hash) && value.mime === 'image/jpeg' &&
    Number.isInteger(value.size) && value.size > 0 && value.size <= 2 * 1024 * 1024 &&
    Number.isInteger(value.width) && value.width > 0 && value.width <= 1600 &&
    Number.isInteger(value.height) && value.height > 0 && value.height <= 1600 &&
    typeof value.thumbnail === 'string' && value.thumbnail.startsWith('data:image/jpeg;base64,') && value.thumbnail.length <= 200000,
  'WEEKLY_IMAGE', '配图处理结果无效。');
  const source = readImage(dataDir, value), directory = managed(workspace, ['.bilibili-harness', 'weekly', 'images']);
  const target = join(directory, value.hash + '.jpg');
  if (existsSync(target)) assert(!lstatSync(target).isSymbolicLink() && lstatSync(target).isFile(), 'WEEKLY_PATH', '配图文件不能是链接。');
  const temporary = join(directory, randomUUID() + '.tmp'); writeFileSync(temporary, source, { mode: 0o600 }); renameSync(temporary, target);
  return { hash: value.hash, mime: value.mime, size: value.size, width: value.width, height: value.height, thumbnail: value.thumbnail };
}
export const sameRoot = (a, b) => {
  const canonical = value => process.platform === 'win32' ? realpathSync(value).toLowerCase() : realpathSync(value);
  return canonical(a) === canonical(b);
};
export function releaseStaged(dataDir, workspace, image) {
  if (sameRoot(dataDir, workspace)) return;
  readImage(dataDir, image);
  unlinkSync(join(managed(dataDir, ['.bilibili-harness', 'weekly', 'images']), image.hash + '.jpg'));
}
export function collectImages(root, keep, remove = false) {
  const directory = managed(root, ['.bilibili-harness', 'weekly', 'images']);
  const files = readdirSync(directory), result = { scanned: 0, referenced: 0, reclaimable: 0, bytes: 0, removed: 0, skipped: 0, more: files.length > 5000 };
  let readBytes = 0;
  for (const file of files.slice(0, 5000)) {
    result.scanned++;
    if (!/^[a-f0-9]{64}\.jpg$/.test(file)) { result.skipped++; continue; }
    const hash = file.slice(0, 64), path = join(directory, file), stat = lstatSync(path);
    if (stat.isSymbolicLink() || !stat.isFile() || stat.size > 2 * 1024 * 1024) { result.skipped++; continue; }
    if (keep.has(hash)) { result.referenced++; continue; }
    if (readBytes + stat.size > 64 * 1024 * 1024) { result.more = true; break; }
    readBytes += stat.size;
    // A replaced file may belong to the user; only reclaim unchanged plugin content.
    if (digest(readFileSync(path)) !== hash) { result.skipped++; continue; }
    result.reclaimable++; result.bytes += stat.size;
    if (remove) { unlinkSync(path); result.removed++; }
  }
  return result;
}
export function writeWeekly(workspace, draft) {
  const directory = managed(workspace, ['.bilibili-harness', 'weekly']);
  assert(/^[A-Za-z0-9_-]{8,100}$/.test(draft.id), 'WEEKLY_PATH', '动态草稿标识无效。');
  const text = ['# 周总结动态草稿', '状态：' + draft.state + '；修订：' + draft.revision,
    '发送账号 UID：' + draft.accountUid, '唯一对话：' + draft.sessionId,
    '素材范围：' + new Date(draft.start).toISOString() + ' 至 ' + new Date(draft.end).toISOString(),
    '说明：仅使用已保存的公开浏览材料；需用户审核。平台接收回执不等于公开展示。', '', draft.body || '等待生成',
    ...draft.mentions.map(t => '@' + t.name + '（UID ' + t.uid + '）'), '',
    ...draft.images.flatMap((image, i) => ['## 配图 ' + (i + 1), `![配图](images/${image.hash}.jpg)`, '内容摘要：' + image.hash, '']),
    '## 素材来源', ...draft.sources.map(s => '- [' + s.title.replace(/[\[\]\n]/g, ' ') + '](' + s.url + ') · ' + s.source),
    '', draft.reason || '', ...(draft.receipt ? ['动态定位：https://t.bilibili.com/' + draft.receipt] : [])].join('\n');
  const target = join(directory, draft.id + '.md');
  if (existsSync(target)) assert(!lstatSync(target).isSymbolicLink(), 'WEEKLY_PATH', '草稿文件不能是链接。');
  const temporary = join(directory, randomUUID() + '.tmp'); writeFileSync(temporary, text, { encoding: 'utf8', mode: 0o600 }); renameSync(temporary, target);
  return relative(realpathSync(workspace), target);
}
