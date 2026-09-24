import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createAppServer, buildApiRequest } from '../../server/index.js';
import { buildSdkRequest, fetchAmap } from '../../server/upstream.js';
import { createLimiter } from '../../server/limits.js';
const config = { jsKey: 'TEST_JS_PUBLIC', securityCode: 'TEST_JS_SECRET', webKey: 'TEST_WEB_SECRET', origin: '', ratingScale: null };
const params = () => new URLSearchParams({ foodId: 'chongqing-noodles', step: '0', lng: '116.4', lat: '39.9', radius: '1000' });
async function server(t, options = {}) {
  const s = createAppServer({ config, ...options }); s.listen(0, '127.0.0.1'); await once(s, 'listening');
  t.after(() => new Promise(resolve => { s.close(resolve); s.closeAllConnections(); }));
  return `http://127.0.0.1:${s.address().port}`;
}
test('服务端决定关键词、类型、排序、分页与商业字段，不允许客户端覆盖', () => {
  const spec = buildApiRequest('/api/nearby', params(), config);
  assert.equal(spec.path, '/v5/place/around');
  assert.equal(spec.params.keywords, '重庆小面'); assert.equal(spec.params.types, '050000'); assert.equal(spec.params.sortrule, 'weight');
  assert.equal(spec.params.page_size, 20); assert.equal(spec.params.page_num, 1); assert.equal(spec.params.show_fields, 'business'); assert.ok(!('city_limit' in spec.params));
  const invalid = [['foodId', 'bogus'], ['step', '3'], ['radius', '10000'], ['lng', '181'], ['lat', ''], ['keywords', '随意关键词'], ['url', 'http://localhost'], ['page_num', '2']];
  for (const [key, value] of invalid) { const p = params(); p.set(key, value); assert.throws(() => buildApiRequest('/api/nearby', p, config), { code: 'BAD_REQUEST' }); }
});
test('手动搜索关键词长度和格式限制；拒绝未知路径', () => {
  for (const q of ['', 'x'.repeat(81), 'a|b']) assert.throws(() => buildApiRequest('/api/places', new URLSearchParams({ q }), config), { code: 'BAD_REQUEST' });
  assert.throws(() => buildApiRequest('/api/proxy', new URLSearchParams(), config), { code: 'NOT_FOUND' });
});
test('配置仅返回公开 JS Key；无配置仍正常提供界面', async t => {
  const base = await server(t);
  const body = await (await fetch(base + '/api/config')).text();
  assert.ok(body.includes(config.jsKey)); assert.ok(!body.includes(config.securityCode)); assert.ok(!body.includes(config.webKey));
  const empty = await server(t, { config: { jsKey: '', securityCode: '', webKey: '' } });
  assert.equal((await fetch(empty + '/')).status, 200);
  const response = await fetch(empty + '/api/nearby?' + params()); assert.equal(response.status, 503); assert.equal((await response.json()).error.code, 'NOT_CONFIGURED');
});
test('真实 HTTP 代理发向固定主机，裁剪响应字段，服务器 Key 不返回', async t => {
  let called;
  const base = await server(t, { fetchImpl: async (url, options) => { called = url; assert.equal(options.redirect, 'manual'); return Response.json({ status: '1', pois: [{ id: 'a', name: '测试', location: '116.4,39.9', typecode: '050100', extra: config.webKey, business: { rating: [] } }] }); } });
  const response = await fetch(base + '/api/nearby?' + params()), body = await response.json();
  assert.equal(called.origin, 'https://restapi.amap.com'); assert.equal(called.searchParams.get('key'), config.webKey);
  assert.equal(body.matchLevel, 'specific'); assert.equal(body.pois[0].business.rating, ''); assert.ok(!JSON.stringify(body).includes(config.webKey));
});
for (const [code, expected] of [['10001', 'KEY_INVALID'], ['10003', 'QUOTA'], ['10012', 'FORBIDDEN'], ['10015', 'QUOTA'], ['10016', 'UPSTREAM']]) test(`高德 ${code} 转为 ${expected}，错误内容不回显`, async t => {
  const base = await server(t, { fetchImpl: async () => Response.json({ status: '0', infocode: code, info: config.webKey }) });
  const response = await fetch(base + '/api/nearby?' + params()); const body = await response.json();
  assert.notEqual(response.status, 200); assert.equal(body.error.code, expected); assert.ok(!JSON.stringify(body).includes(config.webKey));
});
test('超时、网络错误、非法 JSON 与空列表相互区别', async t => {
  const base = await server(t, { upstreamTimeout: 15, fetchImpl: (_, { signal }) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason))) });
  assert.equal((await (await fetch(base + '/api/nearby?' + params())).json()).error.code, 'TIMEOUT');
  await assert.rejects(fetchAmap('/v5/place/text', {}, { fetchImpl: async () => { throw Error(config.webKey); } }), { code: 'NETWORK' });
  await assert.rejects(fetchAmap('/v5/place/text', {}, { fetchImpl: async () => new Response('<html>oops</html>') }), { code: 'INVALID_RESPONSE' });
});
test('严格路径和请求方法、跨站请求阻断、无目录或环境文件暴露', async t => {
  const base = await server(t);
  for (const path of ['/.env', '/server/index.js', '/package.json', '/api/proxy?url=https://example.com', '/_AMapService/v5/place/around', '/%2e%2e%2f.env']) assert.ok((await fetch(base + path)).status >= 400, path);
  assert.equal((await fetch(base + '/api/places?q=x', { method: 'POST' })).status, 405);
  assert.equal((await fetch(base + '/api/places?q=x', { headers: { Origin: 'https://evil.example' } })).status, 403);
  assert.equal((await fetch(base + '/api/places?q=x', { headers: { 'Sec-Fetch-Site': 'cross-site' } })).status, 403);
});
test('安全代理只转换单坐标，服务端注入安全密钥，JSONP 回调受限', async t => {
  const query = new URLSearchParams({ key: config.jsKey, locations: '116.4,39.9', coordsys: 'gps', callback: 'AMap.cb' });
  const url = new URL('/_AMapService/v3/assistant/coordinate/convert?' + query, 'http://localhost');
  const spec = buildSdkRequest(url, config); assert.equal(spec.params.jscode, config.securityCode); assert.ok(!('callback' in spec.params));
  assert.equal(spec.params.s, 'rsv3'); assert.equal(spec.params.platform, 'JS'); assert.equal(spec.params.logversion, '2.0');
  const bad = new URL(url); bad.searchParams.set('callback', 'alert(1)//'); assert.throws(() => buildSdkRequest(bad, config), { code: 'BAD_REQUEST' });
  bad.searchParams.set('locations', '116,39;117,40'); assert.throws(() => buildSdkRequest(bad, config));
  const base = await server(t, { fetchImpl: async () => Response.json({ status: '1', locations: '116.406,39.901', jscode: config.securityCode }) });
  const body = await (await fetch(base + url.pathname + url.search)).text();
  assert.match(body, /^AMap\.cb\(/); assert.ok(!body.includes(config.securityCode));
});
test('IP/全局/每日限流与时间窗口恢复，伪造头不绕过默认限制', async t => {
  let time = 0; const l = createLimiter({ perMinute: 2, globalMinute: 3, globalDay: 4, now: () => time });
  assert.equal(l.allow('a'), true); assert.equal(l.allow('a'), true); assert.equal(l.allow('a'), false); assert.equal(l.allow('b'), true); assert.equal(l.allow('c'), false);
  time = 61000; assert.equal(l.allow('a'), true); assert.equal(l.allow('a'), false); time = 86400000; assert.equal(l.allow('a'), true);
  const base = await server(t, { limiter: createLimiter({ perMinute: 1 }), fetchImpl: async () => Response.json({ status: '1', pois: [] }) });
  await fetch(base + '/api/places?q=x', { headers: { 'X-Forwarded-For': '1.2.3.4' } });
  const limited = await fetch(base + '/api/places?q=x', { headers: { 'X-Forwarded-For': '2.3.4.5' } });
  assert.equal(limited.status, 429); assert.equal(limited.headers.get('retry-after'), '60');
});
test('生产源地址要求 HTTPS，仅回环构建预览允许 HTTP', () => {
  for (const origin of ['', 'http://eat.example.com', 'https://eat.example.com/path']) assert.throws(() => createAppServer({ production: true, config: { ...config, origin } }));
});
