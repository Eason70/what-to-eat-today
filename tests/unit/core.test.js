import test from 'node:test';
import assert from 'node:assert/strict';
import { EVERYDAY, SPECIAL, FOODS } from '../../src/food-data.js';
import { drawFood } from '../../src/random.js';
import { createSettingsStore, STORAGE_KEY } from '../../src/storage.js';
import { normalizePois, mergePois, rankPois, coordinates, distanceMeters, validRating, needsCenterConfirmation, normalizePlaces } from '../../src/ranking.js';
import { locationFromResult, navigationUrl } from '../../src/amap-service.js';

const center = { lng: 116.4, lat: 39.9, name: '测试中心', source: 'manual', savedAt: Date.now() };
const poi = (id, overrides = {}) => ({ id, name: '测试分店', location: '116.401,39.9', typecode: '050100', address: '测试地址', business: { rating: '4.2' }, ...overrides });
const options = { center, radius: 1000, matchLevel: 'specific', ratingScale: 5 };
test('固定 56 + 8 项、唯一稳定 ID、全部搜索计划完整', () => {
  assert.equal(EVERYDAY.length, 56); assert.equal(SPECIAL.length, 8); assert.equal(new Set(FOODS.map(f => f.id)).size, 64);
  for (const f of FOODS) {
    assert.ok(f.name && f.category); assert.match(f.id, /^[a-z-]+$/);
    assert.ok(f.searchPlan.length >= 1 && f.searchPlan.length <= 3);
    for (const p of f.searchPlan) { assert.ok(p.keyword.length <= 80 && p.keyword.length > 0); assert.ok(['specific', 'related'].includes(p.matchLevel)); assert.ok(!['餐饮', '美食', '快餐'].includes(p.keyword)); }
  }
});
test('95% 分界与池内每一个等宽区间都正确', () => {
  for (const [poolRoll, pool] of [[0, EVERYDAY], [0.949999999, EVERYDAY], [0.95, SPECIAL], [0.999999999, SPECIAL]]) {
    for (let i = 0; i < pool.length; i++) { const values = [poolRoll, (i + 0.5) / pool.length]; assert.equal(drawFood(() => values.shift()), pool[i]); }
  }
});
test('连续抽到同项合法；非法随机源拒绝', () => {
  assert.equal(drawFood(() => 0), drawFood(() => 0));
  for (const n of [-1, 1, NaN, Infinity]) assert.throws(() => drawFood(() => n), RangeError);
});
test('有种子的辅助统计落在宽松区间，不要求每 20 次出特别项', () => {
  let seed = 42, count = 0;
  const rng = () => ((seed = (1664525 * seed + 1013904223) >>> 0) / 2 ** 32);
  for (let i = 0; i < 100000; i++) if (drawFood(rng).pool === 'special') count++;
  assert.ok(count > 4600 && count < 5400, `special=${count}`);
});
test('坏存储、读写权限失败、越界数据不崩溃，保留内存设置', () => {
  for (const raw of ['{', 'null', '[]', '{"radius":10000,"center":{"lng":999}}']) {
    const store = createSettingsStore({ getItem: () => raw, setItem() {} }); assert.deepEqual(store.read(), { radius: 1000, center: null });
  }
  const store = createSettingsStore({ getItem() { throw Error('denied'); }, setItem() { throw Error('denied'); } });
  store.save({ radius: 3000, center }); assert.equal(store.read().radius, 3000);
});
test('只持久化设置与带来源和时间的中心，不保存食物或门店', () => {
  let data; const store = createSettingsStore({ getItem: key => { assert.equal(key, STORAGE_KEY); return data; }, setItem: (_, v) => { data = v; } });
  store.save({ radius: 500, center, food: FOODS[0], restaurants: ['private'] });
  const result = store.read(); assert.equal(result.center.source, 'manual'); assert.equal(result.center.savedAt, center.savedAt);
  assert.deepEqual(Object.keys(JSON.parse(data)), ['radius', 'center']);
});
test('坐标严格验证且直线距离正常', () => {
  for (const v of ['', null, [], ['',''], '181,20', '1,91', '0,0', '116,39,2']) assert.equal(coordinates(v), null);
  assert.ok(distanceMeters(center, { lng: 116.41, lat: 39.9 }) > 800);
  assert.equal(distanceMeters(center, center), 0);
});
test('按坐标过滤越界、缺坐标、非餐饮、异常 POI，不信任 distance', () => {
  const result = normalizePois([poi('ok'), poi('outside', { location: '116.5,39.9', distance: '1' }), poi('missing', { location: [] }), poi('bank', { typecode: '160100' }), null], options);
  assert.deepEqual(result.map(p => p.id), ['ok']); assert.ok(result[0].distance > 80);
});
test('同名不同 ID 保留；重复 ID 合并有效字段并保留更具体来源', () => {
  const specific = normalizePois([poi('a', { business: {} })], options);
  const related = normalizePois([poi('a', { business: { rating: '4.6', opentime_today: '09:00-20:00' } }), poi('b')], { ...options, matchLevel: 'related' });
  const merged = mergePois(related, specific); assert.equal(merged.length, 2); assert.equal(merged[0].matchLevel, 'specific'); assert.equal(merged[0].rating, 4.6); assert.equal(merged[0].hours, '09:00-20:00');
});
test('缺失、数组、空、零与超范围评分无效；量纲未确认一律关闭', () => {
  for (const v of ['', [], null, 'NaN', '0', '6', -1, true]) assert.equal(validRating(v, 5), null);
  assert.equal(validRating('4.5', null), null); assert.equal(validRating('4.5', 5), 4.5);
});
test('相关层级先于综合分，缺评分只内部补中位数，最多 6 家', () => {
  const a = normalizePois([poi('a', { business: {} }), poi('b')], options);
  const b = normalizePois(Array.from({ length: 12 }, (_, i) => poi(`r${i}`, { location: '116.40001,39.9', business: { rating: 5 } })), { ...options, matchLevel: 'related' });
  const result = rankPois(mergePois(a, b), 1000, 5);
  assert.equal(result.length, 6); assert.equal(result[0].matchLevel, 'specific'); assert.equal(result[1].matchLevel, 'specific');
  assert.equal(result.find(p => p.id === 'a').rating, null); assert.ok(result.every(p => !Object.hasOwn(p, 'score')));
});
test('整层无评分时按统一距离/顺序权重，稳定 ID 打破平局', () => {
  const a = normalizePois([poi('b', { business: {} })], options)[0];
  const results = rankPois([{ ...a, id: 'b' }, { ...a, id: 'a' }, { ...a, id: 'c', distance: 900 }], 1000, 5);
  assert.deepEqual(results.map(p => p.id), ['a', 'b', 'c']);
});
test('手动地点不接受缺坐标；候选地址有城市和区县', () => {
  const result = normalizePlaces([poi('a', { pname: '测试省', cityname: '测试市', adname: '测试区' }), poi('b', { location: [] })]);
  assert.equal(result.length, 1); assert.match(result[0].address, /测试市.*测试区/);
});
test('精度与半径不相称或 IP 中心要求确认，手动和明确确认的中心可用', () => {
  assert.equal(needsCenterConfirmation({ ...center, source: 'geolocation', accuracy: 300 }, 500), true);
  assert.equal(needsCenterConfirmation({ ...center, source: 'geolocation', accuracy: 300 }, 1000), false);
  assert.equal(needsCenterConfirmation({ ...center, source: 'geolocation', coarse: true, accuracy: 30 }, 5000), true);
  assert.equal(needsCenterConfirmation(center, 500), false);
});
test('定位适配不混用坐标；IP 标粗略；可靠坐标无地址也成功', () => {
  assert.throws(() => locationFromResult({ position: center, isConverted: false }));
  const result = locationFromResult({ position: center, isConverted: true, accuracy: 20, location_type: 'h5' });
  assert.equal(result.name, '当前位置'); assert.equal(result.coarse, false);
  assert.equal(locationFromResult({ position: center, isConverted: true, accuracy: 20, location_type: 'ip' }).coarse, true);
});
test('兼容真实 SDK html5 转换成功但标志为 false，拒绝缺失或失败的转换证据', () => {
  const response = { position: { getLng: () => center.lng, getLat: () => center.lat }, isConverted: false,
    info: 'SUCCESS', message: 'Get geolocation success.Convert Success.', location_type: 'html5', accuracy: 20 };
  const result = locationFromResult(response);
  assert.equal(result.lng, center.lng); assert.equal(result.lat, center.lat); assert.equal(result.coarse, false);
  for (const message of ['', 'Get geolocation success.', 'Convert failed.', 'Convert Success.Failed.', 'Not Convert Success.']) {
    assert.throws(() => locationFromResult({ ...response, message }), { code: 'LOCATION_FAILED' });
  }
  assert.throws(() => locationFromResult({ ...response, info: 'FAILED' }), { code: 'LOCATION_FAILED' });
  assert.throws(() => locationFromResult({ ...response, location_type: 'ip' }), { code: 'LOCATION_FAILED' });
});
test('导航准确编码目的地且不提供搜索中心为起点，不指定出行方式', () => {
  const url = new URL(navigationUrl({ ...center, name: '店 & <分店>' }));
  assert.equal(url.origin, 'https://uri.amap.com'); assert.equal(url.searchParams.get('position'), '116.4,39.9');
  assert.equal(url.searchParams.get('name'), '店 & <分店>'); assert.equal(url.searchParams.get('callnative'), '1');
  for (const key of ['from', 'mode', 'start']) assert.equal(url.searchParams.has(key), false);
  assert.equal(new URL(navigationUrl(center, false)).searchParams.get('callnative'), '0');
});
