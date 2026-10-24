export function coverUrl(value) {
  if (typeof value !== 'string' || value.length > 4000) return '';
  try {
    const url = new URL(value.startsWith('//') ? 'https:' + value : value);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password ||
      (url.port && url.port !== '443') || !['hdslb.com', 'biliimg.com'].some(host =>
        url.hostname === host || url.hostname.endsWith('.' + host))) return '';
    url.protocol = 'https:';
    return url.href;
  } catch { return ''; }
}
