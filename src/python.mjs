import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, realpathSync, lstatSync } from 'node:fs';
import { join, relative, isAbsolute } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { PluginError } from './errors.mjs';
export { installAudio } from './dependencies.mjs';

export function bundledPython() {
  const win = join(homedir(), '.dsh', 'dsh-runtimes', 'dsh-primary-runtime', 'dependencies', 'python', 'python.exe');
  return existsSync(win) ? win : (process.platform === 'win32' ? 'python' : 'python3');
}
export function venvPython(root) {
  return join(root, process.platform === 'win32' ? 'Scripts' : 'bin', process.platform === 'win32' ? 'python.exe' : 'python');
}
export function pythonFor(config, dataDir, packageDir) {
  return config.pythonPath || [venvPython(join(dataDir, '.venv')), venvPython(join(packageDir, '.venv'))]
    .find(existsSync) || bundledPython();
}
export class BiliReader {
  constructor({ python, worker, dataDir }) {
    this.python = python; this.worker = worker; this.dataDir = dataDir;
    this.pending = new Map(); this.buffer = '';
  }
  start() {
    if (this.child) return;
    const temporary = join(this.dataDir, 'tmp');
    mkdirSync(temporary, { recursive: true, mode: 0o700 });
    const child = spawn(this.python, ['-u', this.worker], {
      shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, BILI_HARNESS_DATA: this.dataDir, PYTHONIOENCODING: 'utf-8',
        TEMP: temporary, TMP: temporary, TMPDIR: temporary },
    });
    this.child = child;
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', text => {
      this.buffer += text;
      if (this.buffer.length > 2_000_000) { this.close(); return; }
      let at;
      while ((at = this.buffer.indexOf('\n')) >= 0) {
        const line = this.buffer.slice(0, at); this.buffer = this.buffer.slice(at + 1);
        let response;
        try { response = JSON.parse(line); } catch { continue; }
        const item = this.pending.get(response.id);
        if (!item) continue;
        this.pending.delete(response.id); clearTimeout(item.timer);
        if (response.error) item.reject(new PluginError(response.error.code || 'BILI_READ',
          response.error.message || 'B站读取未完成。'));
        else item.resolve(response.result);
      }
    });
    child.stderr.resume();
    const fail = () => {
      if (this.child !== child) return;
      this.child = null;
      for (const item of this.pending.values()) {
        clearTimeout(item.timer);
        item.reject(new PluginError('PYTHON_NOT_READY', '读取环境未就绪，请先准备 Python 依赖或检查解释器设置。', 503));
      }
      this.pending.clear(); this.buffer = '';
    };
    child.on('error', fail); child.on('exit', fail); child.stdin.on('error', fail);
  }
  call(method, params = {}, timeoutMs = 65000) {
    if (!['ping', 'account', 'login_start', 'login_poll', 'logout', 'read_video', 'read_cover', 'search_videos', 'recommend_videos', 'audio_check', 'audio_cleanup', 'transcribe_video',
      'contacts_page', 'dm_inbox', 'dm_thread', 'dm_reply', 'relationship_probe', 'follow_user', 'dm_proactive_probe', 'dm_proactive_send', 'user_info', 'comment_probe', 'comment_publish', 'comment_verify',
      'interaction_scan', 'owner_mentions', 'comment_feedback', 'comment_reply_probe', 'comment_reply_publish', 'comment_reply_verify', 'weekly_image', 'weekly_card', 'weekly_probe', 'weekly_publish', 'weekly_verify'].includes(method)) {
      return Promise.reject(new PluginError('READ_ONLY', '此版本不支持该适配操作。'));
    }
    this.start();
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new PluginError(method === 'transcribe_video' ? 'AUDIO_TIMEOUT' : 'BILI_TIMEOUT',
          method === 'transcribe_video' ? '音频处理超时，已停止读取进程；本次占额保留，不自动重试。' : 'B站读取超时，请稍后重试。', 504));
        this.close();
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.child.stdin.write(JSON.stringify({ id, method, params }) + '\n', error => {
        if (error) this.close();
      });
    });
  }
  close() {
    const child = this.child; this.child = null;
    child?.kill();
    for (const item of this.pending.values()) {
      clearTimeout(item.timer);
      item.reject(new PluginError('READER_CLOSED', '读取进程已停止，请重试。', 503));
    }
    this.pending.clear(); this.buffer = '';
  }
}
function command(executable, args, timeoutMs, env, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new PluginError('INSTALL_CANCELLED', '依赖准备已停止。')); return; }
    const child = spawn(executable, args, { shell: false, windowsHide: true, stdio: 'ignore', env });
    const abort = () => { child.kill(); reject(new PluginError('INSTALL_CANCELLED', '依赖准备已停止。')); };
    signal?.addEventListener('abort', abort, { once: true });
    const cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); };
    const timer = setTimeout(() => { child.kill(); reject(new PluginError('INSTALL_TIMEOUT', '依赖准备超时。')); }, timeoutMs);
    child.once('error', () => { cleanup(); reject(new PluginError('INSTALL_FAILED', '无法启动 Python。')); });
    child.once('exit', code => {
      cleanup();
      if (code === 0) resolve();
      else reject(new PluginError('INSTALL_FAILED', 'Python 环境准备未完成，请检查网络或设置已有解释器。'));
    });
  });
}
export async function installPython({ basePython = bundledPython(), target, requirements, signal, onProgress = () => {} }) {
  mkdirSync(target, { recursive: true, mode: 0o700 });
  const temporary = join(target, '.setup-temp');
  mkdirSync(temporary, { recursive: true, mode: 0o700 });
  const env = { ...process.env, TEMP: temporary, TMP: temporary, TMPDIR: temporary,
    PIP_CACHE_DIR: join(target, '.pip-cache'), PIP_NO_INPUT: '1' };
  onProgress('creating_env');
  await command(basePython, ['-m', 'venv', target], 60000, env, signal);
  onProgress('installing_packages');
  await command(venvPython(target), ['-m', 'pip', 'install', '--disable-pip-version-check',
    '--timeout', '15', '--retries', '1', '-r', requirements], 240000, env, signal);
  return venvPython(target);
}
export function downloadWhisperModel({ python, script, modelsDir, model, source, signal, onProgress = () => {}, timeoutMs = 1800000 }) {
  if (!['tiny', 'base', 'small', 'medium'].includes(model) || !['official', 'mirror'].includes(source))
    return Promise.reject(new PluginError('MODEL_INPUT', '请选择支持的Whisper型号和下载源。'));
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new PluginError('INSTALL_CANCELLED', '模型准备已停止。')); return; }
    if (existsSync(modelsDir) && lstatSync(modelsDir).isSymbolicLink()) {
      reject(new PluginError('MODEL_PATH', '模型目录不能是符号链接。')); return;
    }
    mkdirSync(modelsDir, { recursive: true, mode: 0o700 });
    const root = realpathSync(modelsDir);
    const child = spawn(python, ['-u', script, '--root', root, '--model', model, '--source', source], {
      shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, PYTHONIOENCODING: 'utf-8', HF_HOME: join(root, '.hf-cache'),
        HF_HUB_DISABLE_IMPLICIT_TOKEN: '1', HF_HUB_DISABLE_XET: '1' },
    });
    let buffer = '', result, settled = false, timer, stoppingError;
    const finish = (error, value) => {
      if (settled) return;
      settled = true; clearTimeout(timer); signal?.removeEventListener('abort', abort);
      error ? reject(error) : resolve(value);
    };
    const stop = error => { stoppingError ||= error; child.kill(); };
    const abort = () => stop(new PluginError('INSTALL_CANCELLED', '模型准备已停止；已有可用模型保留，可重新点击继续准备。'));
    signal?.addEventListener('abort', abort, { once: true });
    child.once('spawn', () => { if (stoppingError) stop(stoppingError); else if (signal?.aborted) abort(); });
    timer = setTimeout(() => stop(new PluginError('MODEL_DOWNLOAD_TIMEOUT', '模型准备超过30分钟，已停止。可检查下载源后重试，已有模型保留。')), timeoutMs);
    child.stderr.resume();
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      if (settled || stoppingError) return;
      buffer += chunk;
      if (buffer.length > 65536) { stop(new PluginError('MODEL_PROTOCOL', '模型准备进程返回异常。')); return; }
      let position;
      while ((position = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, position); buffer = buffer.slice(position + 1);
        let value;
        try { value = JSON.parse(line); } catch { continue; }
        if (value.ok === true) result = value.result;
        if (['checking_model', 'downloading_model', 'verifying_model'].includes(value.stage)) {
          const progress = { stage: value.stage };
          if (Number.isSafeInteger(value.downloadedBytes) && Number.isSafeInteger(value.totalBytes) &&
            value.downloadedBytes >= 0 && value.downloadedBytes <= value.totalBytes && value.totalBytes <= 2_000_000_000)
            Object.assign(progress, { downloadedBytes: value.downloadedBytes, totalBytes: value.totalBytes });
          onProgress(progress);
        }
      }
    });
    child.once('error', () => finish(new PluginError('MODEL_SETUP_FAILED', '无法启动模型准备进程，请先准备音频依赖。')));
    child.once('exit', code => {
      if (settled) return;
      if (stoppingError) { finish(stoppingError); return; }
      try {
        if (code !== 0 || result?.model !== model || typeof result.path !== 'string' || !/^[a-f0-9]{40}$/.test(result.revision))
          throw new Error();
        const path = realpathSync(result.path), remainder = relative(root, path);
        if (!remainder || remainder.startsWith('..') || isAbsolute(remainder) ||
          !['config.json', 'model.bin', 'tokenizer.json'].every(name => existsSync(join(path, name)))) throw new Error();
        finish(null, { path, model, revision: result.revision, reused: result.reused === true });
      } catch { finish(new PluginError('MODEL_SETUP_FAILED', '模型准备未完成，请检查下载源、网络、磁盘或音频依赖；原模型设置已保留。')); }
    });
  });
}
