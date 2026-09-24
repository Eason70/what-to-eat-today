import test from 'node:test';
import assert from 'node:assert/strict';
import { handleRequest } from '../../cloudflare/worker.js';

const origin = 'https://food.example';
const secrets = { AMAP_JS_KEY: 'test-public', AMAP_SECURITY_JS_CODE: 'test-private-js', AMAP_WEB_SERVICE_KEY: 'test-private-web' };
const environment = overrides => ({ ...secrets, AMAP_ENABLED: 'true', API_RATE_LIMITER: { limit: async () => ({ success: true }) }, ...overrides });
const request = (path, options) => new Request(origin + path, options);
const upstream = body => ({ fetchImpl: async () => Response.json({ status: '1', ...body }) });

test('Worker 默认关闭高德，即使已有密钥也不调用上游或公开 JS Key', async () => {
  const env = environment({ AMAP_ENABLED: 'false' });
  const config = await (await handleRequest(request('/api/config'), env)).json();
  assert.equal(config.amapEnabled, false); assert.equal(config.jsKey, ''); assert.equal(config.webConfigured, false);
  const response = await handleRequest(request('/api/places?q=北京'), env, { fetchImpl: () => assert.fail('disabled upstream called') });
  assert.equal(response.status, 503); assert.equal((await response.json()).error.code, 'AMAP_DISABLED');
});

test('Worker 配置只公开 JS Key 和状态；所有接口响应禁止缓存', async () => {
  const response = await handleRequest(request('/api/config'), environment());
  const text = await response.text();
  assert.ok(text.includes(secrets.AMAP_JS_KEY));
  assert.ok(!text.includes(secrets.AMAP_SECURITY_JS_CODE)); assert.ok(!text.includes(secrets.AMAP_WEB_SERVICE_KEY));
  assert.equal(response.headers.get('cache-control'), 'no-store');
});

test('Worker 拒绝跨站、错误方法、未知路径和覆盖服务端参数', async () => {
  const noNetwork = { fetchImpl: () => assert.fail('invalid request called upstream') };
  const inputs = [
    [request('/api/places?q=a', { headers: { Origin: 'https://evil.example' } }), 403],
    [request('/api/places?q=a', { headers: { Referer: 'https://evil.example/' } }), 403],
    [request('/api/places?q=a', { headers: { 'Sec-Fetch-Site': 'cross-site' } }), 403],
    [request('/api/places?q=a', { headers: { Referer: 'invalid' } }), 400],
    [request('/api/places?q=a', { method: 'POST' }), 405],
    [request('/api/proxy?url=https://evil.example'), 404],
    [request('/api/places?q=a&key=override'), 400],
    [request('/api/places?q=a&q=b'), 400],
  ];
  for (const [input, status] of inputs) assert.equal((await handleRequest(input, environment(), noNetwork)).status, status);
});

test('Worker 限流拒绝及绑定缺失均不放行上游；使用可信 CF 客户端 IP', async () => {
  let rateKey;
  const limiter = { limit: async value => { rateKey = value.key; return { success: false }; } };
  const input = request('/api/places?q=a', { headers: { 'CF-Connecting-IP': '192.0.2.1', 'X-Forwarded-For': 'spoofed' } });
  const noNetwork = { fetchImpl: () => assert.fail('limited request called upstream') };
  const limited = await handleRequest(input, environment({ API_RATE_LIMITER: limiter }), noNetwork);
  assert.equal(limited.status, 429); assert.equal(limited.headers.get('retry-after'), '60'); assert.equal(rateKey, '192.0.2.1');
  assert.equal((await handleRequest(input, environment({ API_RATE_LIMITER: undefined }), noNetwork)).status, 503);
});

test('Worker 附近查询保留检索规则并裁剪上游响应', async () => {
  let called;
  const response = await handleRequest(request('/api/nearby?foodId=chongqing-noodles&step=0&lng=116.4&lat=39.9&radius=1000'), environment(), {
    fetchImpl: async (url, options) => { called = url; assert.equal(options.redirect, 'error'); return Response.json({ status: '1', pois: [{ id: '1', name: '店', location: '116.4,39.9', extra: secrets.AMAP_WEB_SERVICE_KEY }] }); },
  });
  assert.equal(called.origin, 'https://restapi.amap.com'); assert.equal(called.searchParams.get('key'), secrets.AMAP_WEB_SERVICE_KEY);
  assert.equal(called.searchParams.get('keywords'), '重庆小面');
  const data = await response.json(); assert.equal(data.matchLevel, 'specific'); assert.equal(data.pois[0].name, '店'); assert.equal(data.pois[0].extra, undefined);
});

test('Worker 位置搜索、逆编码和 SDK 坐标转换返回兼容数据', async () => {
  const places = await handleRequest(request('/api/places?q=北京'), environment(), upstream({ pois: [] }));
  assert.deepEqual(await places.json(), { pois: [] });
  const reverse = await handleRequest(request('/api/reverse?lng=116.4&lat=39.9'), environment(), upstream({ regeocode: { formatted_address: '测试地址' } }));
  assert.deepEqual(await reverse.json(), { name: '测试地址' });
  const sdk = await handleRequest(request('/_AMapService/v3/assistant/coordinate/convert?key=test-public&locations=116.4,39.9&coordsys=gps&callback=callback.ok'), environment(), upstream({ locations: '116.41,39.91' }));
  assert.match(await sdk.text(), /^callback\.ok\(\{"status":"1"/);
  assert.match(sdk.headers.get('content-type'), /javascript/);
});

test('Worker 不把上游错误细节和密钥返回给用户', async () => {
  const response = await handleRequest(request('/api/places?q=a'), environment(), { fetchImpl: async () => { throw new Error(secrets.AMAP_WEB_SERVICE_KEY); } });
  assert.deepEqual(await response.json(), { error: { code: 'NETWORK' } });
});

test('Worker 静态资源通过绑定处理，不使用本地文件系统', async () => {
  let forwarded;
  const env = environment({ ASSETS: { fetch: async value => { forwarded = value; return new Response('static'); } } });
  const input = request('/src/app.js');
  assert.equal(await (await handleRequest(input, env)).text(), 'static'); assert.equal(forwarded, input);
});
