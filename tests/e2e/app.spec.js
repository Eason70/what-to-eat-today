import { test, expect } from '@playwright/test';

const center = { lng: 116.4, lat: 39.9, name: '测试搜索中心', source: 'manual', savedAt: Date.now() - 60000, accuracy: null, coarse: false };
const raw = (id, overrides = {}) => ({ id, name: `测试门店 ${id}`, location: '116.401,39.9', typecode: '050100', address: '测试市测试区测试街 12 号', business: { rating: '4.4', opentime_today: '10:00-22:00' }, ...overrides });
test.beforeEach(async ({ page }) => { page.on('pageerror', error => { throw error; }); });
async function init(page, { cached = true, special = false, index = 0, motion = 'reduce', sdk = false } = {}) {
  await page.emulateMedia({ reducedMotion: motion });
  await page.route('**/api/config*', route => route.fulfill({ json: { jsConfigured: false, jsKey: '', webConfigured: true, pwaEnabled: false } }));
  await page.addInitScript(({ cached, center, special, index, sdk }) => {
    let calls = 0; Math.random = () => { calls++; return calls % 2 ? special ? 0.99 : 0 : (index + 0.5) / (special ? 8 : 56); };
    window.drawCalls = () => calls;
    if (cached) localStorage.setItem('what-to-eat-settings-v1', JSON.stringify({ radius: 1000, center }));
    if (sdk) window.AMap = { Geolocation: class { getCurrentPosition(cb) { window.resolveGeo = result => cb('complete', result); } } };
  }, { cached, center, special, index, sdk });
}
async function draw(page) { await page.getByRole('button', { name: '随机一下', exact: true }).click(); await expect(page.getByRole('button', { name: '附近哪有', exact: true })).toBeVisible(); }
async function mockNearby(page, fn = () => [raw('a'), raw('b'), raw('c')]) {
  await page.route('**/api/nearby?*', async route => {
    const url = new URL(route.request().url());
    const result = await fn(url, route);
    if (result === undefined) return;
    await route.fulfill({ json: { pois: result, matchLevel: Number(url.searchParams.get('step')) === 0 ? 'specific' : 'related', ratingScale: 5 } });
  });
}
async function noOverflow(page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}
test('无 Key/无位置仍可抽取，真实服务显示配置限制', async ({ page }) => {
  await page.goto('/'); await draw(page);
  await page.getByRole('button', { name: '附近哪有', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.locator('#place-status')).toContainText('尚未配置');
  await page.getByRole('button', { name: '关闭位置选择' }).click();
  await expect(page.locator('#primary')).toBeFocused();
  await expect(page.locator('#food-name')).not.toHaveText('今天吃什么？');
});
test('正常动画约 840ms，快速连点不排队，过程不播报菜名', async ({ page }) => {
  await init(page, { motion: 'no-preference' }); await page.goto('/');
  await page.locator('#primary').evaluate(button => { for (let i = 0; i < 20; i++) button.click(); });
  await expect(page.locator('#primary')).toBeDisabled();
  await expect(page.locator('#draw-announcement')).toHaveText('');
  await expect(page.locator('#food-name')).toHaveAttribute('aria-hidden', 'true');
  await expect(page.locator('#food-name')).toHaveText('烤肉拌饭');
  await expect(page.locator('#primary')).toBeEnabled();
  expect(await page.evaluate(() => window.drawCalls())).toBe(2);
  await expect(page.locator('#draw-announcement')).toHaveText('烤肉拌饭');
});
test('特别池一次抽取直接展示，减少动画偏好不滚动', async ({ page }) => {
  await init(page, { special: true }); await page.goto('/'); await draw(page);
  await expect(page.locator('#special-label')).toBeVisible(); await expect(page.locator('#food-name')).toHaveText('川渝火锅');
  expect(await page.evaluate(() => window.drawCalls())).toBe(2);
});
test('列表最多六家、相关备选标注、错误文本不注入、导航只有目的地', async ({ page }) => {
  await init(page); let calls = 0;
  await mockNearby(page, url => {
    calls++;
    return Number(url.searchParams.get('step')) === 0 ? [raw('a', { name: '<img src=x onerror=alert(1)>测试门店', business: {} })] : Array.from({ length: 10 }, (_, i) => raw(`r${i}`));
  });
  await page.goto('/'); await draw(page); expect(calls).toBe(0);
  await page.locator('#primary').click(); await expect(page.locator('.restaurant')).toHaveCount(6);
  await expect(page.locator('.restaurant').first()).toContainText('<img src=x onerror=alert(1)>');
  await expect(page.locator('.restaurant img')).toHaveCount(0); await expect(page.locator('.related-label')).toHaveCount(5);
  await expect(page.locator('.restaurant').first()).not.toContainText('评分');
  const url = new URL(await page.locator('.go-link').first().getAttribute('href'));
  expect(url.searchParams.get('position')).toBe('116.401,39.9'); expect(url.searchParams.has('from')).toBe(false);
  expect(url.searchParams.has('mode')).toBe(false); expect(calls).toBe(2);
  await page.locator('#again').click(); await expect(page.locator('.restaurant')).toHaveCount(0); await expect(page.locator('#nearby')).toBeHidden();
});
test('修改范围保持食物；未展开不预查，展开后刷新', async ({ page }) => {
  await init(page); let calls = 0; await mockNearby(page, () => { calls++; return [raw('a'), raw('b'), raw('c')]; });
  await page.goto('/'); await draw(page); const food = await page.locator('#food-name').textContent();
  await page.locator('input[value="3000"]').check(); expect(calls).toBe(0);
  await page.locator('#primary').click(); await expect(page.locator('.restaurant')).toHaveCount(3);
  await page.locator('input[value="500"]').check(); await expect(page.locator('#search-context')).toContainText('500m');
  await expect(page.locator('.restaurant')).toHaveCount(3); await expect(page.locator('#food-name')).toHaveText(food); expect(calls).toBe(2);
});
test('零结果仅在成功后显示，逐档扩大到5km止，保留原食物', async ({ page }) => {
  await init(page); await mockNearby(page, () => []); await page.goto('/'); await draw(page);
  await page.locator('input[value="500"]').check(); await page.locator('#primary').click();
  for (const [empty, next] of [['500m', '1km'], ['1km', '3km'], ['3km', '5km']]) {
    await expect(page.locator('#search-status')).toContainText(`${empty}内暂未找到`);
    await page.getByRole('button', { name: `扩大到 ${next}`, exact: true }).click();
  }
  await expect(page.locator('#search-status')).toContainText('5km内暂未找到');
  await expect(page.getByRole('button', { name: /扩大到/ })).toHaveCount(0); await expect(page.locator('#food-name')).toHaveText('烤肉拌饭');
});
test('配额错误不当零结果或扩大理由，允许重试', async ({ page }) => {
  await init(page); let calls = 0;
  await page.route('**/api/nearby?*', route => { calls++; return route.fulfill({ status: 429, json: { error: { code: 'QUOTA' } } }); });
  await page.goto('/'); await draw(page); await page.locator('#primary').click();
  await expect(page.locator('#search-status')).toContainText('额度或请求频率'); await expect(page.locator('#search-status')).not.toContainText('未找到');
  await expect(page.getByRole('button', { name: '重试', exact: true })).toBeVisible(); expect(calls).toBe(1);
  await expect(page.getByRole('button', { name: /扩大到/ })).toHaveCount(0);
});
test('后续查询失败时保留部分结果并明确提示', async ({ page }) => {
  await init(page);
  await mockNearby(page, async (url, route) => { if (url.searchParams.get('step') === '0') return [raw('a')]; await route.fulfill({ status: 502, json: { error: { code: 'NETWORK' } } }); });
  await page.goto('/'); await draw(page); await page.locator('#primary').click();
  await expect(page.locator('.restaurant')).toHaveCount(1); await expect(page.locator('#search-status')).toContainText('尚未完成全部查询');
});
test('手动搜索必须选候选，位置弹层聚焦、关闭归还焦点，继续原查店', async ({ page }) => {
  await init(page, { cached: false }); await mockNearby(page);
  await page.route('**/api/places?*', route => route.fulfill({ json: { pois: [raw('mall', { name: '测试商场', cityname: '测试市', adname: '测试区' }), raw('invalid', { location: [] })] } }));
  await page.goto('/'); await draw(page); await page.locator('#primary').click();
  await expect(page.getByRole('dialog')).toBeVisible();
  for (let i = 0; i < 8; i++) { await page.keyboard.press('Tab'); expect(await page.evaluate(() => !!document.activeElement.closest('dialog'))).toBe(true); }
  await page.locator('#place-query').fill('测试商场'); await expect(page.locator('#place-results button')).toHaveCount(1);
  await expect(page.locator('#location-label')).toHaveText('尚未设置');
  await page.locator('#place-results button').click(); await expect(page.getByRole('dialog')).toBeHidden();
  await expect(page.locator('#primary')).toBeFocused(); await expect(page.locator('.restaurant')).toHaveCount(3);
  await expect(page.locator('#location-label')).toHaveText('搜索中心：测试商场'); await expect(page.locator('#food-name')).toHaveText('烤肉拌饭');
});
test('晚到自动定位不能覆盖手动中心', async ({ page }) => {
  await init(page, { cached: false, sdk: true });
  await page.route('**/api/places?*', route => route.fulfill({ json: { pois: [raw('mall', { name: '手动地点' })] } }));
  await page.goto('/'); await page.locator('#edit-location').click(); await page.locator('#place-query').fill('商场');
  await page.locator('#place-results button').click();
  await page.evaluate(() => window.resolveGeo({ position: { lng: 117, lat: 40 }, accuracy: 10, isConverted: true, location_type: 'h5', formattedAddress: '晚到的自动位置' }));
  await expect(page.locator('#location-label')).toHaveText('搜索中心：手动地点');
});
test('粗略定位必须确认，确认后可按选点搜索', async ({ page }) => {
  await init(page, { cached: false, sdk: true }); await mockNearby(page); await page.goto('/');
  await page.waitForFunction(() => typeof window.resolveGeo === 'function');
  await page.evaluate(() => window.resolveGeo({ position: { lng: 116.4, lat: 39.9 }, accuracy: 5000, isConverted: true, location_type: 'ip' }));
  await draw(page); await page.locator('#primary').click(); await expect(page.locator('#confirm-center')).toBeVisible();
  await expect(page.locator('#confirm-description')).toContainText('5000 米');
  await page.locator('#accept-center').click(); await expect(page.locator('.restaurant')).toHaveCount(3);
  await expect(page.locator('#location-label')).toContainText('搜索中心：');
});
test('真实生产构建离线重开可抽取，缓存只有静态资源', async ({ page, context }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' }); await page.goto('/');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload(); await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  const cached = await page.evaluate(async () => {
    const keys = await caches.keys(); const urls = [];
    for (const key of keys) for (const req of await (await caches.open(key)).keys()) urls.push(req.url);
    return { keys, urls };
  });
  expect(cached.keys).toHaveLength(1); expect(cached.urls.some(u => u.includes('food-data.js'))).toBe(true);
  expect(cached.urls.some(u => /api\/|amap\.com|[?&]key=/.test(u))).toBe(false);
  await context.setOffline(true); await page.reload(); await draw(page);
  await page.locator('#primary').click(); await expect(page.getByRole('dialog')).toBeVisible();
  await page.locator('#place-query').fill('商场'); await expect(page.locator('#place-status')).toContainText('离线');
});
for (const width of [320, 375, 390, 430, 1280]) test(`${width}px 布局、长文案、错误提示与弹层无横向溢出`, async ({ page }) => {
  await page.setViewportSize({ width, height: 844 }); await init(page, { index: 27 });
  await mockNearby(page, () => [raw('a', { name: '很长的真实返回名称'.repeat(10), address: '测试地址'.repeat(35), business: { opentime_week: '周一至周五 10:00–22:00；周末 10:00–23:00'.repeat(4) } }), raw('b'), raw('c')]);
  await page.goto('/'); await noOverflow(page);
  await page.screenshot({ path: `test-results/layout-${width}-initial.png`, fullPage: true });
  await draw(page); await noOverflow(page); await page.locator('#primary').click(); await expect(page.locator('.restaurant')).toHaveCount(3); await noOverflow(page);
  await page.screenshot({ path: `test-results/layout-${width}-results.png`, fullPage: true });
  await page.locator('#edit-location').click(); await page.locator('#place-query').fill('很长的城市与街道名称'.repeat(5));
  await expect(page.locator('#place-status')).toContainText('尚未配置'); await noOverflow(page);
  await page.setViewportSize({ width, height: 400 }); await page.locator('#place-query').focus(); await noOverflow(page);
  await expect.poll(() => page.locator('#place-query').evaluate(n => n.getBoundingClientRect().bottom <= Math.min(window.innerHeight, n.closest('dialog').getBoundingClientRect().bottom))).toBe(true);
  await page.screenshot({ path: `test-results/layout-${width}-dialog.png`, fullPage: true });
  await page.keyboard.press('Escape'); await expect(page.locator('#edit-location')).toBeFocused();
});
test('200% 字体放大可操作且不溢出', async ({ page }) => {
  await init(page); await page.goto('/');
  await page.addStyleTag({ content: 'html { font-size: 200%; }' });
  await draw(page); await noOverflow(page); await page.locator('#edit-location').click(); await noOverflow(page);
});
test('真实浏览器中旧半径请求晚到也不覆盖新结果', async ({ page }) => {
  await init(page); let release, oldStarted;
  const gate = new Promise(r => { release = r; }); const started = new Promise(r => { oldStarted = r; });
  await mockNearby(page, async url => {
    if (url.searchParams.get('radius') === '1000') { oldStarted(); await gate; return [raw('old'), raw('old2'), raw('old3')]; }
    return [raw('new'), raw('new2'), raw('new3')];
  });
  await page.goto('/'); await draw(page); await page.locator('#primary').click(); await started;
  await page.locator('input[value="500"]').check(); await expect(page.locator('.restaurant').first()).toContainText('new');
  release(); await expect(page.locator('#search-context')).toContainText('500m'); await expect(page.locator('.restaurant').first()).toContainText('new');
});
test('高德脚本加载失败仍能抽取，地点搜索可独立使用', async ({ page }) => {
  await init(page, { cached: false }); await page.unroute('**/api/config*');
  await page.route('**/api/config*', route => route.fulfill({ json: { jsConfigured: true, jsKey: 'TEST_PUBLIC_KEY', webConfigured: true, pwaEnabled: false } }));
  await page.route('https://webapi.amap.com/**', route => route.abort());
  await page.goto('/'); await expect(page.locator('#location-note')).toContainText('定位组件未能加载'); await draw(page);
  await expect(page.locator('#food-name')).toHaveText('烤肉拌饭');
});
test('拒绝定位只自动尝试一次，用户主动定位才重试', async ({ page }) => {
  await init(page, { cached: false });
  await page.addInitScript(() => { window.geoCalls = 0; window.AMap = { Geolocation: class { getCurrentPosition(cb) { window.geoCalls++; cb('error', { info: 'PERMISSION_DENIED' }); } } }; });
  await page.goto('/'); await expect(page.locator('#location-note')).toContainText('未获定位权限');
  await draw(page); await page.locator('#again').click(); expect(await page.evaluate(() => window.geoCalls)).toBe(1);
  await page.locator('#retry-location').click(); expect(await page.evaluate(() => window.geoCalls)).toBe(2);
});
test('断网时清除已展开门店，不将旧列表当实时结果', async ({ page, context }) => {
  await init(page); await mockNearby(page); await page.goto('/'); await draw(page); await page.locator('#primary').click();
  await expect(page.locator('.restaurant')).toHaveCount(3); await context.setOffline(true);
  await expect(page.locator('.restaurant')).toHaveCount(0); await expect(page.locator('#search-status')).toContainText('离线');
  await page.locator('#again').click(); await expect(page.locator('#food-name')).toHaveText('烤肉拌饭');
});
test('新 worker 激活清理旧缓存，保留其他应用缓存', async ({ page }) => {
  await init(page); await page.goto('/');
  await page.evaluate(async () => {
    await (await caches.open('what-to-eat-obsolete')).put('/old.js', new Response('old'));
    await (await caches.open('unrelated-app')).put('/other.js', new Response('other'));
    await navigator.serviceWorker.register('/sw.js'); await navigator.serviceWorker.ready;
  });
  await expect.poll(() => page.evaluate(() => caches.keys())).not.toContain('what-to-eat-obsolete');
  expect(await page.evaluate(() => caches.keys())).toContain('unrelated-app');
});
