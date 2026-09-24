// 单进程预算保护，不持久化 IP。内存键有上限；重启会重置，不能替代高德账户配额。
export function createLimiter({ perMinute = 90, globalMinute = 300, globalDay = 5000, now = Date.now } = {}) {
  const clients = new Map(); let minute = -1, day = -1, minuteCount = 0, dayCount = 0;
  return { allow(ip) {
    const time = now(), m = Math.floor(time / 60000), d = Math.floor(time / 86400000);
    if (m !== minute) { minute = m; minuteCount = 0; clients.clear(); }
    if (d !== day) { day = d; dayCount = 0; }
    const count = clients.get(ip) || 0;
    if (count >= perMinute || minuteCount >= globalMinute || dayCount >= globalDay || (!clients.has(ip) && clients.size >= 5000)) return false;
    clients.set(ip, count + 1); minuteCount++; dayCount++; return true;
  } };
}
