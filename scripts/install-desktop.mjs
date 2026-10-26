import { existsSync, readFileSync, writeFileSync, mkdirSync, realpathSync, symlinkSync, renameSync, lstatSync, unlinkSync, rmdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
const project = resolve(fileURLToPath(new URL('..', import.meta.url)));
const profile = join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'profiles', 'desktop');
const file = join(profile, 'package.json');
const original = readFileSync(file, 'utf8');
const value = JSON.parse(original);
const name = JSON.parse(readFileSync(join(project, 'package.json'), 'utf8')).name;
const legacyName = 'dsh-bilibili-harness';
const link = join(profile, 'node_modules', name);
const specifier = 'link:' + project.replaceAll('\\', '/');
const legacyLink = join(profile, 'node_modules', legacyName);
const legacyLinkOurs = existsSync(legacyLink) && realpathSync(legacyLink).toLowerCase() === realpathSync(project).toLowerCase();
const legacyOurs = value.dependencies?.[legacyName] === specifier ||
  legacyLinkOurs;
if (value.dependencies?.[name] && value.dependencies[name] !== specifier) throw new Error('此插件名已有其他安装，未覆盖。');
if (existsSync(link) && realpathSync(link).toLowerCase() !== realpathSync(project).toLowerCase()) {
  throw new Error('插件目标已被其他目录占用，未覆盖。');
}
const bundles = value.dsh?.profile?.bundles;
if (!Array.isArray(bundles)) throw new Error('桌面 profile 格式与预期不符，未修改。');
if (name !== legacyName && bundles.includes(legacyName) && !legacyOurs) throw new Error('旧包名指向另一份安装，请先核对安装目录，未覆盖。');
value.dependencies = { ...value.dependencies, [name]: specifier };
if (name !== legacyName && legacyOurs) delete value.dependencies[legacyName];
value.dsh.profile.bundles = [...new Set(bundles.map(bundle => legacyOurs && bundle === legacyName ? name : bundle))];
if (!value.dsh.profile.bundles.includes(name)) value.dsh.profile.bundles.push(name);
console.log('目标：' + profile);
console.log('本地插件：' + project);
console.log('安装包名：' + name + (legacyOurs && name !== legacyName ? '；会迁移旧 bundle 引用并清理本项目旧别名，避免重复加载。' : ''));
if (!process.argv.includes('--apply')) {
  console.log('预览通过。执行 node scripts/install-desktop.mjs --apply 安装本地链接；保留全部已有依赖、脚本与配置。');
} else {
  const backups = join(project, '.runtime', 'backups'); mkdirSync(backups, { recursive: true });
  const backup = join(backups, 'desktop-package-before-' + new Date().toISOString().replaceAll(':', '-') + '.json');
  writeFileSync(backup, original, { flag: 'wx' });
  if (readFileSync(file, 'utf8') !== original) throw new Error('profile 在安装时发生变化，请重新运行。');
  if (name !== legacyName && legacyLinkOurs && !lstatSync(legacyLink).isSymbolicLink()) throw new Error('旧别名不是目录链接，未删除，请先核对安装。');
  if (!existsSync(link)) symlinkSync(project, link, process.platform === 'win32' ? 'junction' : 'dir');
  const temporary = join(profile, '.bilibili-harness-install.tmp');
  writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
  renameSync(temporary, file);
  if (name !== legacyName && legacyLinkOurs) {
    // Remove only the verified link itself, never recurse into the source directory.
    if (process.platform === 'win32') rmdirSync(legacyLink); else unlinkSync(legacyLink);
  }
  console.log('安装完成；备份：' + backup);
  console.log('请保存 DSH 当前工作后重启应用，在设置中打开“B站浏览”。');
}
