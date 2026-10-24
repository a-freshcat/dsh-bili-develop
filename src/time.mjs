const formatters = new Map();
function parts(at, zone) {
  let formatter = formatters.get(zone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit',
      day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    formatters.set(zone, formatter);
  }
  return Object.fromEntries(formatter.formatToParts(new Date(at)).map(p => [p.type, p.value]));
}
export function localDay(at, zone) {
  const p = parts(at, zone); return p.year + '-' + p.month + '-' + p.day;
}
export function dayWindow(at, zone) {
  const day = localDay(at, zone);
  let left = at - 48 * 3600000, right = at;
  while (right - left > 1) {
    const mid = Math.floor((left + right) / 2);
    if (localDay(mid, zone) === day) right = mid; else left = mid;
  }
  const start = right;
  left = at; right = at + 48 * 3600000;
  while (right - left > 1) {
    const mid = Math.floor((left + right) / 2);
    if (localDay(mid, zone) === day) left = mid; else right = mid;
  }
  return { day, zone, start, end: right };
}
export function inActivity(at, config) {
  const p = parts(at, config.timeZone);
  const current = Number(p.hour) * 60 + Number(p.minute);
  const minutes = text => Number(text.slice(0, 2)) * 60 + Number(text.slice(3));
  const start = minutes(config.activityStart), end = minutes(config.activityEnd);
  return start === end || (start < end ? current >= start && current < end : current >= start || current < end);
}
export function nextActivity(at, config) {
  if (inActivity(at, config)) return at;
  // Minute stepping handles overnight windows and timezone/DST transitions.
  let next = Math.floor(at / 60000) * 60000 + 60000;
  for (let i = 0; i < 49 * 60; i++, next += 60000) if (inActivity(next, config)) return next;
  return at + 24 * 3600000;
}
