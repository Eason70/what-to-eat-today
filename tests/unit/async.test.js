import test from 'node:test';
import assert from 'node:assert/strict';
import { AppController } from '../../src/controller.js';
import { searchPlan, requestJSON } from '../../src/amap-service.js';
import { createPlaceSearch } from '../../src/place-search.js';
import { FOOD_BY_ID } from '../../src/food-data.js';
import { ServiceError } from '../../src/errors.js';

const center = { lng: 116.4, lat: 39.9, name: '测试中心', source: 'manual', savedAt: Date.now() };
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const tick = () => new Promise(r => setTimeout(r, 10));
function setup(service = {}, extra = {}) {
  return new AppController({ service, store: { read: () => ({ radius: 1000, center }), save() {} }, delay: async () => {}, rng: () => 0, ...extra });
}
const poi = id => ({ id, name: '测试门店', location: '116.401,39.9', typecode: '050100', business: {} });
test('快速连点抽取只抽一次，延时结束前不改最终结果', async () => {
  const wait = deferred(); let calls = 0; const c = setup({}, { delay: () => wait.promise, rng: () => { calls++; return 0; } });
  const first = c.draw(); await c.draw(); await c.draw(); assert.equal(calls, 2); assert.equal(c.state.food, null);
  wait.resolve(); await first; assert.equal(c.state.food.name, '烤肉拌饭');
});
test('半径/位置在结果未展开时不发起查询、不重抽', async () => {
  let requests = 0; const c = setup({ searchNearby: async () => { requests++; return { pois: [] }; } }); await c.draw();
  const food = c.state.food; c.setRadius(3000); c.setCenter({ ...center, name: '另一地点' }); assert.equal(c.state.food, food); assert.equal(requests, 0);
});
for (const change of ['radius', 'center', 'food']) test(`变更 ${change} 后旧响应被取消且不能覆盖新结果`, async () => {
  const requests = [];
  const c = setup({ searchNearby: args => { const d = deferred(); requests.push({ ...d, args }); return d.promise; } });
  await c.draw(); const old = c.search();
  if (change === 'radius') c.setRadius(3000);
  if (change === 'center') c.setCenter({ ...center, lng: 116.42 });
  if (change === 'food') { await c.draw(); void c.search(); }
  assert.equal(requests[0].args.signal.aborted, true);
  requests[1].resolve({ pois: [{ id: 'new' }] }); await tick();
  requests[0].resolve({ pois: [{ id: 'old' }] }); await old;
  assert.deepEqual(c.state.results.map(p => p.id), ['new']);
});
test('旧错误同样不能覆盖新搜索', async () => {
  const a = deferred(), b = deferred(); let n = 0;
  const c = setup({ searchNearby: () => ++n === 1 ? a.promise : b.promise }); await c.draw(); const old = c.search(); c.setRadius(500);
  b.resolve({ pois: [] }); await tick(); a.reject(new ServiceError('NETWORK')); await old; assert.equal(c.state.searchStatus, 'empty');
});
test('缺位置保留食物，设置中心后继续原来的搜索', async () => {
  let requests = 0; const c = setup({ searchNearby: async () => { requests++; return { pois: [] }; } }); c.state.center = null;
  await c.draw(); const food = c.state.food; await c.search(); assert.equal(c.state.searchStatus, 'waiting-location');
  c.setCenter(center); await tick(); assert.equal(c.state.food, food); assert.equal(requests, 1);
});
test('手动选择后晚到自动定位及地址不覆盖；自动定位不重复', async () => {
  const d = deferred(); let calls = 0;
  const c = setup({ locate: () => { calls++; return d.promise; } }); const old = c.locate({ automatic: true });
  c.setCenter({ ...center, name: '手动地点' }); d.resolve({ ...center, name: 'GPS' }); await old; await c.locate({ automatic: true });
  assert.equal(c.state.center.name, '手动地点'); assert.equal(calls, 1);
});
test('定位拒绝保留缓存和时间、无自动循环；地址失败不否定坐标', async () => {
  const c = setup({ locate: async () => { throw new ServiceError('LOCATION_DENIED'); } }); await c.locate({ automatic: true });
  assert.equal(c.state.cached, true); assert.equal(c.state.center.savedAt, center.savedAt); assert.equal(c.state.locationError.code, 'LOCATION_DENIED');
  c.service = { locate: async () => ({ ...center, source: 'geolocation', name: '当前位置', accuracy: 10 }), reverseGeocode: async () => { throw Error(); } };
  await c.locate(); assert.equal(c.state.locationError, null); assert.equal(c.state.center.name, '当前位置');
});
test('已定位后晚到逆编码不覆盖手动中心', async () => {
  const d = deferred(); const c = setup({ locate: async () => ({ ...center, source: 'geolocation', name: '当前位置', accuracy: 10 }), reverseGeocode: () => d.promise });
  const locating = c.locate(); await tick(); c.setCenter({ ...center, name: '手动' }); d.resolve('旧地址'); await locating; assert.equal(c.state.center.name, '手动');
});
test('候选不足 3 才继续，达到 3 停止；只取 20 条且不分页', async () => {
  const food = FOOD_BY_ID.get('chongqing-noodles'); const calls = [];
  const result = await searchPlan({ food, center, radius: 1000 }, async (_, p) => { calls.push(p); return { pois: p.step === 0 ? [poi('a')] : [poi('a'), poi('b'), poi('c')], matchLevel: food.searchPlan[p.step].matchLevel, ratingScale: null }; });
  assert.equal(calls.length, 2); assert.equal(result.pois.length, 3); assert.ok(calls.every(c => c.radius === 1000));
});
test('计划耗尽成功才是零结果；错误不扩大关键词；部分结果可保留', async () => {
  const food = FOOD_BY_ID.get('chongqing-noodles'); let count = 0;
  const empty = await searchPlan({ food, center, radius: 500 }, async (_, p) => { count++; return { pois: [], matchLevel: food.searchPlan[p.step].matchLevel }; });
  assert.equal(empty.pois.length, 0); assert.equal(count, 3);
  count = 0;
  await assert.rejects(searchPlan({ food, center, radius: 500 }, async () => { count++; throw new ServiceError('KEY_INVALID'); }), { code: 'KEY_INVALID' }); assert.equal(count, 1);
  count = 0;
  const partial = await searchPlan({ food, center, radius: 500 }, async () => { if (count++) throw new ServiceError('QUOTA'); return { pois: [poi('a')], matchLevel: 'specific' }; });
  assert.equal(partial.partial, true); assert.equal(partial.pois.length, 1); assert.equal(partial.error.code, 'QUOTA'); assert.equal(count, 2);
});
test('手动搜索防抖且输入改变立即使旧响应失效，关闭时取消', async () => {
  const requests = [], results = [];
  const s = createPlaceSearch({ debounceMs: 2, search: (q, signal) => { const d = deferred(); requests.push({ ...d, q, signal }); return d.promise; }, onResult: r => results.push(r), onStatus() {} });
  s.update('a'); s.update('ab'); await tick(); assert.equal(requests.length, 1); assert.equal(requests[0].q, 'ab');
  s.update('abc'); requests[0].resolve(['old']); await tick(); assert.equal(requests[0].signal.aborted, true); assert.ok(!results.some(r => r.includes('old')));
  s.cancel(); requests[1].resolve(['closed']); await tick(); assert.ok(!results.some(r => r.includes('closed')));
});
test('HTTP 错误、坏 JSON、网络与超时区分', async () => {
  await assert.rejects(requestJSON('/x', {}, { fetchImpl: async () => Response.json({ error: { code: 'NOT_CONFIGURED' } }, { status: 503 }) }), { code: 'NOT_CONFIGURED' });
  await assert.rejects(requestJSON('/x', {}, { fetchImpl: async () => new Response('bad') }), { code: 'INVALID_RESPONSE' });
  await assert.rejects(requestJSON('/x', {}, { fetchImpl: async () => { throw Error(); } }), { code: 'NETWORK' });
  await assert.rejects(requestJSON('/x', {}, { timeout: 3, fetchImpl: (_, { signal }) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason))) }), { code: 'TIMEOUT' });
});
