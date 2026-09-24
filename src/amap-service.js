import { ServiceError } from './errors.js';
import { coordinates, textValue, numberValue, normalizePois, mergePois, rankPois, normalizePlaces } from './ranking.js';

export async function requestJSON(path, params = {}, { signal, fetchImpl = globalThis.fetch, timeout = 12000 } = {}) {
  if (globalThis.navigator?.onLine === false) throw new ServiceError('OFFLINE');
  const controller = new AbortController();
  const abort = () => controller.abort(signal.reason);
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => controller.abort(new DOMException('Timeout', 'TimeoutError')), timeout);
  try {
    const response = await fetchImpl(`${path}?${new URLSearchParams(params)}`, { signal: controller.signal, cache: 'no-store', credentials: 'same-origin' });
    let data;
    try { data = await response.json(); } catch { throw new ServiceError('INVALID_RESPONSE'); }
    if (!response.ok) throw new ServiceError(data?.error?.code || 'UPSTREAM');
    return data;
  } catch (error) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    if (controller.signal.aborted) throw new ServiceError('TIMEOUT');
    if (error instanceof ServiceError) throw error;
    throw new ServiceError('NETWORK');
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
}

// 只有成功但候选不足才继续兜底。可注入请求函数做确定性适配测试。
export async function searchPlan({ food, center, radius, signal }, request = requestJSON) {
  let candidates = [], ratingScale = null;
  for (let step = 0; step < Math.min(food.searchPlan.length, 3); step++) {
    signal?.throwIfAborted();
    try {
      const data = await request('/api/nearby', { foodId: food.id, step, lng: center.lng, lat: center.lat, radius }, { signal });
      signal?.throwIfAborted();
      if (!Array.isArray(data?.pois) || data.matchLevel !== food.searchPlan[step].matchLevel) throw new ServiceError('INVALID_RESPONSE');
      ratingScale = data.ratingScale === 5 ? 5 : null;
      candidates = mergePois(candidates, normalizePois(data.pois, { center, radius, matchLevel: data.matchLevel, ratingScale }));
      if (candidates.length >= 3) break;
    } catch (error) {
      if (signal?.aborted || error.name === 'AbortError') throw error;
      if (!candidates.length) throw error;
      return { pois: rankPois(candidates, radius, ratingScale), partial: true, error };
    }
  }
  return { pois: rankPois(candidates, radius, ratingScale), partial: false };
}

let sdkPromise;
export async function loadAmap() {
  if (globalThis.AMap?.Geolocation) return globalThis.AMap;
  if (sdkPromise) return sdkPromise;
  sdkPromise = (async () => {
    const config = await requestJSON('/api/config');
    if (config.amapEnabled === false) throw new ServiceError('AMAP_DISABLED');
    if (!config.jsConfigured || !config.jsKey) throw new ServiceError('JS_NOT_CONFIGURED');
    globalThis._AMapSecurityConfig = { serviceHost: `${location.origin}/_AMapService` };
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      const timer = setTimeout(() => finish(new ServiceError('SDK_LOAD')), 12000);
      function finish(error) {
        clearTimeout(timer); script.onload = script.onerror = null;
        if (error) { script.remove(); reject(error); } else resolve(globalThis.AMap);
      }
      script.src = `https://webapi.amap.com/maps?${new URLSearchParams({ v: '2.0', key: config.jsKey, plugin: 'AMap.Geolocation' })}`;
      script.async = true;
      script.onerror = () => finish(new ServiceError('SDK_LOAD'));
      script.onload = () => {
        if (globalThis.AMap?.Geolocation) finish();
        else if (globalThis.AMap?.plugin) globalThis.AMap.plugin('AMap.Geolocation', () => globalThis.AMap.Geolocation ? finish() : finish(new ServiceError('SDK_LOAD')));
        else finish(new ServiceError('SDK_LOAD'));
      };
      document.head.append(script);
    });
  })().catch(error => { sdkPromise = null; throw error; });
  return sdkPromise;
}
export function locationFromResult(result) {
  const position = coordinates({ lng: result?.position?.getLng?.() ?? result?.position?.lng, lat: result?.position?.getLat?.() ?? result?.position?.lat });
  // 当前 JS API 2.0 的 html5 结果在转换成功后仍可能 isConverted=false。
  // 真实联调已核对该成功消息下的坐标与代理转换结果一致；仅兼容明确成功，不能再转换一次。
  const converted = result?.isConverted === true || result?.isConverted === 1 ||
    (result?.location_type === 'html5' && result?.info === 'SUCCESS' &&
      typeof result?.message === 'string' && /(?:^|\.)Convert Success\.$/.test(result.message));
  if (!position || !converted) throw new ServiceError('LOCATION_FAILED');
  const accuracy = numberValue(result.accuracy);
  return { ...position, name: textValue(result.formattedAddress, 100) || '当前位置', source: 'geolocation', savedAt: Date.now(), accuracy,
    coarse: !['h5', 'html5', 'sdk'].includes(result.location_type) || accuracy === null || accuracy <= 0 };
}
export async function locate({ automatic = false } = {}) {
  if (!globalThis.isSecureContext) throw new ServiceError('HTTPS_REQUIRED');
  if (automatic && globalThis.navigator?.permissions?.query) {
    let permission;
    try { permission = await navigator.permissions.query({ name: 'geolocation' }); } catch { /* 不支持权限查询时只作一次正常尝试。 */ }
    if (permission?.state === 'denied') throw new ServiceError('LOCATION_DENIED');
  }
  const AMap = await loadAmap();
  return new Promise((resolve, reject) => {
    let finished = false;
    const finish = (error, center) => { if (finished) return; finished = true; clearTimeout(timer); error ? reject(error) : resolve(center); };
    const timer = setTimeout(() => finish(new ServiceError('TIMEOUT')), 12500);
    try {
      const geo = new AMap.Geolocation({ enableHighAccuracy: true, timeout: 10000, maximumAge: 0, convert: true,
        GeoLocationFirst: true, noIpLocate: 3, getCityWhenFail: false, needAddress: false, useNative: false,
        showButton: false, showMarker: false, showCircle: false, panToLocation: false, zoomToAccuracy: false });
      geo.getCurrentPosition((status, result) => {
        if (status !== 'complete') {
          const info = `${result?.info || ''} ${result?.message || ''}`;
          finish(new ServiceError(/DENIED|denied/i.test(info) ? 'LOCATION_DENIED' : /TIME_OUT|timeout/i.test(info) ? 'TIMEOUT' : 'LOCATION_FAILED')); return;
        }
        try { finish(null, locationFromResult(result)); } catch (error) { finish(error); }
      });
    } catch { finish(new ServiceError('SDK_LOAD')); }
  });
}
export function navigationUrl(poi, callNative = true) {
  const position = coordinates(poi);
  if (!position) throw new ServiceError('BAD_REQUEST');
  return `https://uri.amap.com/marker?${new URLSearchParams({ position: `${position.lng},${position.lat}`, name: textValue(poi.name), src: '今天吃什么', coordinate: 'gaode', callnative: callNative ? '1' : '0' })}`;
}
export const amapService = {
  searchNearby: searchPlan, locate,
  async searchPlaces(query, signal) {
    const result = await requestJSON('/api/places', { q: query }, { signal });
    if (!Array.isArray(result?.pois)) throw new ServiceError('INVALID_RESPONSE');
    return normalizePlaces(result.pois);
  },
  async reverseGeocode(center) {
    const result = await requestJSON('/api/reverse', { lng: center.lng, lat: center.lat });
    return textValue(result?.name, 100);
  },
};
