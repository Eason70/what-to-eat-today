import test from 'node:test';
import assert from 'node:assert/strict';
import pages from '../../cloudflare/pages/worker.js';
import { handleRequest } from '../../cloudflare/worker.js';

test('Pages 将 API 和 SDK 请求原样交给内部绑定，保持源地址和客户端信息', async () => {
  for (const path of ['/api/places?q=北京', '/_AMapService/v3/assistant/coordinate/convert?locations=116.4,39.9']) {
    const input = new Request('https://food.pages.dev' + path, { headers: { Origin: 'https://food.pages.dev', 'CF-Connecting-IP': '192.0.2.1' } });
    const expected = new Response('backend', { headers: { 'Cache-Control': 'no-store' } });
    const response = await pages.fetch(input, { FOOD_API: { fetch: async request => { assert.equal(request, input); return expected; } } });
    assert.equal(response, expected);
  }
});

test('Pages 复用后台跨站校验、密钥隔离和配置响应', async () => {
  const env = { AMAP_ENABLED: 'true', AMAP_JS_KEY: 'public', AMAP_SECURITY_JS_CODE: 'private-js', AMAP_WEB_SERVICE_KEY: 'private-web' };
  const binding = { FOOD_API: { fetch: request => handleRequest(request, env) } };
  const response = await pages.fetch(new Request('https://food.pages.dev/api/config', { headers: { Origin: 'https://food.pages.dev' } }), binding);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { jsConfigured: true, jsKey: 'public', webConfigured: true, pwaEnabled: true, amapEnabled: true });
  const rejected = await pages.fetch(new Request('https://food.pages.dev/api/places?q=北京', { headers: { Origin: 'https://other.example' } }), binding);
  assert.equal(rejected.status, 403);
});

test('Pages 内部绑定缺失或失败时返回脱敏错误，不退回公开 Worker 地址', async () => {
  const input = new Request('https://food.pages.dev/api/config');
  assert.equal((await pages.fetch(input, {})).status, 503);
  const response = await pages.fetch(input, { FOOD_API: { fetch: async () => { throw new Error('private-upstream-data'); } } });
  assert.equal(response.status, 502);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await response.json(), { error: { code: 'NETWORK' } });
});

test('Pages 普通资源走静态绑定，不调用后台', async () => {
  const input = new Request('https://food.pages.dev/src/app.js');
  const response = await pages.fetch(input, { FOOD_API: { fetch: () => assert.fail('static request reached backend') }, ASSETS: { fetch: async request => { assert.equal(request, input); return new Response('asset'); } } });
  assert.equal(await response.text(), 'asset');
});
