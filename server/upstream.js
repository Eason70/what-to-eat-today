import { coordinates, textValue } from '../src/ranking.js';
export class ApiError extends Error {
  constructor(code, status = 502) { super(code); this.code = code; this.status = status; }
}
export function upstreamError(code) {
  if (['10001', '10005', '10006', '10007', '10008', '10009', '10013'].includes(code)) return new ApiError('KEY_INVALID');
  if (['10003', '10004', '10010', '10014', '10015', '10019', '10020', '10021', '10029', '10044', '10045'].includes(code)) return new ApiError('QUOTA', 429);
  if (['10002', '10011', '10012', '10026', '10041', '20011'].includes(code)) return new ApiError('FORBIDDEN', 403);
  return new ApiError('UPSTREAM');
}
const PATHS = new Set(['/v5/place/around', '/v5/place/text', '/v3/geocode/regeo', '/v3/assistant/coordinate/convert']);
export async function fetchAmap(path, params, { fetchImpl = fetch, signal, timeout = 8000 } = {}) {
  if (!PATHS.has(path)) throw new ApiError('FORBIDDEN', 403);
  const timer = AbortSignal.timeout(timeout);
  const combined = signal ? AbortSignal.any([signal, timer]) : timer;
  try {
    const url = new URL(path, 'https://restapi.amap.com');
    url.search = new URLSearchParams(params).toString();
    // Workers 不支持 redirect:error；manual 不跟随跳转，下面将 3xx 作为上游错误拒绝。
    const response = await fetchImpl(url, { signal: combined, redirect: 'manual', headers: { Accept: 'application/json' } });
    if (response.status === 429) throw new ApiError('QUOTA', 429);
    if (!response.ok) throw new ApiError('UPSTREAM');
    if (Number(response.headers.get('content-length')) > 1048576) throw new ApiError('INVALID_RESPONSE');
    const reader = response.body.getReader(); let length = 0; const chunks = [];
    try {
      while (true) { const { done, value } = await reader.read(); if (done) break; length += value.length; if (length > 1048576) { await reader.cancel(); throw new ApiError('INVALID_RESPONSE'); } chunks.push(value); }
    } finally { reader.releaseLock(); }
    let data;
    try { data = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new ApiError('INVALID_RESPONSE'); }
    if (!data || !['0', '1'].includes(String(data.status))) throw new ApiError('INVALID_RESPONSE');
    if (String(data.status) !== '1') throw upstreamError(String(data.infocode));
    return data;
  } catch (error) {
    if (timer.aborted) throw new ApiError('TIMEOUT', 504);
    if (error instanceof ApiError) throw error;
    throw new ApiError('NETWORK');
  }
}
export function buildSdkRequest(url, config) {
  // 只为 Geolocation 的坐标转换开放一个上游路径。IP 定位与城市兜底已关闭。
  if (url.pathname !== '/_AMapService/v3/assistant/coordinate/convert') throw new ApiError('FORBIDDEN', 403);
  if (!config.jsKey || !config.securityCode) throw new ApiError('JS_NOT_CONFIGURED', 503);
  const p = url.searchParams;
  if (p.get('key') !== config.jsKey || p.has('jscode')) throw new ApiError('BAD_REQUEST', 400);
  const location = coordinates(p.get('locations'));
  if (!location || !['gps', 'mapbar', 'baidu', 'autonavi'].includes(p.get('coordsys'))) throw new ApiError('BAD_REQUEST', 400);
  const callback = p.get('callback');
  if (callback && (callback.length > 100 || !/^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)*$/.test(callback))) throw new ApiError('BAD_REQUEST', 400);
  // JS API serviceHost 请求需要 SDK 平台标记；缺失时会被当成 Web服务 Key 校验。
  return { path: '/v3/assistant/coordinate/convert', callback, params: { key: config.jsKey, jscode: config.securityCode, s: 'rsv3', platform: 'JS', logversion: '2.0', locations: `${location.lng.toFixed(6)},${location.lat.toFixed(6)}`, coordsys: p.get('coordsys'), output: 'json' } };
}
export function sanitizePois(pois) {
  return pois.slice(0, 20).filter(p => p && typeof p === 'object').map(p => ({
    id: textValue(p.id, 100), name: textValue(p.name), location: textValue(p.location, 80), typecode: textValue(p.typecode, 80),
    address: textValue(p.address), pname: textValue(p.pname, 80), cityname: textValue(p.cityname, 80), adname: textValue(p.adname, 80),
    business: { rating: typeof p.business?.rating === 'number' ? p.business.rating : textValue(p.business?.rating, 20), opentime_today: textValue(p.business?.opentime_today), opentime_week: textValue(p.business?.opentime_week) },
  }));
}
