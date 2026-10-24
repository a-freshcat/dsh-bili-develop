import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { PluginError } from './errors.mjs';

export function installAudio({ python, requirements, temporary, signal, onProgress = () => {},
  timeoutMs = 600000, idleTimeoutMs = 90000 }) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new PluginError('INSTALL_CANCELLED', '音频依赖准备已停止。')); return; }
    mkdirSync(temporary, { recursive: true, mode: 0o700 });
    const child = spawn(python, ['-m', 'pip', 'install', '--disable-pip-version-check', '--no-color',
      '--progress-bar', 'raw', '--only-binary=:all:', '--timeout', '15', '--retries', '1', '-r', requirements], {
      shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, PYTHONUNBUFFERED: '1', PYTHONIOENCODING: 'utf-8', TEMP: temporary, TMP: temporary,
        TMPDIR: temporary, PIP_NO_INPUT: '1', PIP_CACHE_DIR: join(temporary, 'pip-cache') },
    });
    let settled = false, stopping, timer, idleTimer, failure;
    let progress = { stage: 'resolving_packages' }, lastPublished = 0;
    const publish = patch => {
      if (settled || stopping) return;
      progress = { ...progress, ...patch, activityAt: new Date().toISOString() };
      lastPublished = Date.now(); onProgress(progress);
    };
    const finish = error => {
      if (settled) return;
      settled = true; clearTimeout(timer); clearTimeout(idleTimer);
      signal?.removeEventListener('abort', abort);
      error ? reject(error) : resolve();
    };
    const stop = error => { stopping ||= error; clearTimeout(idleTimer); child.kill(); };
    const abort = () => stop(new PluginError('INSTALL_CANCELLED', '音频依赖准备已停止，可重新检查或再次准备。'));
    const activity = () => {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => stop(new PluginError('INSTALL_STALLED', '音频依赖准备长时间没有下载或安装反馈，已停止；请检查网络后重试。')), idleTimeoutMs);
    };
    function line(text) {
      // Never expose raw pip output: index/proxy URLs can contain credentials.
      if (/CERTIFICATE_VERIFY_FAILED|SSLError/i.test(text)) failure = ['INSTALL_TLS', '下载证书验证失败，请检查网络或已有Python的证书配置。'];
      else if (/ProxyError/i.test(text)) failure = ['INSTALL_PROXY', '音频依赖下载无法连接当前代理，请检查代理设置。'];
      else if (/timed out|Retrying|ConnectionError|ConnectionResetError|Failed to establish|Temporary failure/i.test(text)) {
        failure = ['INSTALL_NETWORK', '音频依赖下载连接失败或超时，请检查网络后重试。'];
        publish({ stage: 'waiting_network' });
      } else if (/No space left|disk is full|WinError 112/i.test(text)) failure = ['INSTALL_DISK', '磁盘空间不足，音频依赖尚未准备完成。'];
      else if (/No matching distribution|Could not find a version/i.test(text)) failure ||= ['INSTALL_WHEEL', '没有找到适合当前Python的预编译音频依赖，请检查解释器版本或下载源。'];
      const packageName = /^(?:Collecting|Requirement already satisfied:)\s+([A-Za-z0-9][A-Za-z0-9_.-]{0,79})/.exec(text)?.[1];
      if (packageName) publish({ stage: 'resolving_packages', packageName: packageName.replaceAll('_', '-').toLowerCase(),
        downloadedBytes: undefined, totalBytes: undefined });
      if (/^\s*(?:Downloading|Using cached)\b/.test(text)) {
        const wheel = /\b([A-Za-z0-9_]{1,80})-[0-9][^/\s]*\.whl/.exec(text)?.[1];
        if (wheel) publish({ stage: 'downloading_packages', packageName: wheel.replaceAll('_', '-').toLowerCase(),
          downloadedBytes: undefined, totalBytes: undefined });
      }
      const bytes = /^Progress (\d+) of (\d+)\s*$/.exec(text);
      if (bytes) {
        const downloadedBytes = Number(bytes[1]), totalBytes = Number(bytes[2]);
        if (Number.isSafeInteger(downloadedBytes) && Number.isSafeInteger(totalBytes) &&
          totalBytes > 0 && downloadedBytes >= 0 && downloadedBytes <= totalBytes && totalBytes <= 4_000_000_000)
          publish({ stage: 'downloading_packages', downloadedBytes, totalBytes });
      }
      if (/^Installing collected packages:/.test(text)) publish({ stage: 'installing_audio_packages', packageName: undefined,
        downloadedBytes: undefined, totalBytes: undefined });
    }
    for (const stream of [child.stdout, child.stderr]) {
      let buffer = '';
      stream.setEncoding('utf8');
      stream.on('data', chunk => {
        if (settled || stopping) return;
        activity(); buffer += chunk;
        const lines = buffer.split(/[\r\n]+/); buffer = lines.pop().slice(-8192);
        for (const value of lines) line(value.trim());
        if (Date.now() - lastPublished > 1000) publish({});
      });
      stream.on('end', () => { if (buffer && !settled && !stopping) line(buffer.trim()); });
    }
    signal?.addEventListener('abort', abort, { once: true });
    child.once('spawn', () => { if (stopping) child.kill(); else if (signal?.aborted) abort(); });
    child.once('error', () => finish(new PluginError('INSTALL_FAILED', '无法启动音频依赖准备进程，请检查Python解释器。')));
    child.once('close', code => finish(stopping || (code === 0 ? null :
      new PluginError(...(failure || ['INSTALL_FAILED', '音频依赖准备未完成，请检查网络或已有Python解释器后重试。'])))));
    timer = setTimeout(() => stop(new PluginError('INSTALL_TIMEOUT', '音频依赖准备超过等待上限，已停止；可检查网络后重试。')), timeoutMs);
    activity(); publish({});
  });
}
