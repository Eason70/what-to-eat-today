import { FOODS } from './food-data.js';
import { createSettingsStore } from './storage.js';
import { AppController } from './controller.js';
import { amapService, navigationUrl, requestJSON } from './amap-service.js';
import { needsCenterConfirmation, RADII, radiusLabel } from './ranking.js';
import { friendlyError, ServiceError } from './errors.js';
import { createPlaceSearch } from './place-search.js';

const el = id => document.getElementById(id);
const dialog = el('location-dialog');
const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
let returnFocus, animationTimer, wasDrawing = false, lastFood, lastResults, lastStatusKey, config, closeAfterLocate = false;
function node(tag, text, className) {
  const n = document.createElement(tag);
  if (text !== undefined) n.textContent = text;
  if (className) n.className = className;
  return n;
}
function action(label, fn) {
  const b = node('button', label, 'secondary-button'); b.type = 'button'; b.addEventListener('click', fn); return b;
}
function openLocation(trigger = document.activeElement) {
  if (!dialog.open) { returnFocus = trigger; dialog.showModal(); }
  renderLocation(controller.state);
  if (config?.webConfigured === false) el('place-status').textContent = friendlyError(new ServiceError('NOT_CONFIGURED'));
}
function closeLocation() { dialog.close(); }
function chooseCenter(center) { controller.setCenter(center); closeLocation(); }
async function search() {
  if (controller.state.searchStatus === 'loading') return;
  const promise = controller.search();
  if (controller.state.searchStatus === 'waiting-location') openLocation(el('primary'));
  await promise;
}
function renderLocation(s) {
  const center = s.center, confirmation = center && needsCenterConfirmation(center, s.radius);
  if (closeAfterLocate && !s.locating) {
    closeAfterLocate = false;
    if (dialog.open && center && !confirmation && !s.locationError) closeLocation();
  }
  el('location-label').textContent = center ? (s.cached ? `使用上次位置 · ${center.name}` : center.source === 'geolocation' ? center.name : `搜索中心：${center.name}`) : s.locating ? '正在定位…' : '尚未设置';
  const notes = [];
  if (s.cached) notes.push(`保存于 ${new Date(center.savedAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}，请确认仍适合查店。`);
  if (s.locating && center) notes.push('正在尝试重新定位…');
  if (s.locationError) notes.push(friendlyError(s.locationError));
  if (confirmation) notes.push('定位精度不足或未知，请确认搜索中心。');
  el('location-note').textContent = notes.join(' '); el('location-note').hidden = notes.length === 0;
  el('retry-location').hidden = !(s.cached || s.locationError || confirmation);
  el('retry-location').disabled = s.locating;
  el('locate').disabled = s.locating;
  el('locate').textContent = s.locating ? '正在定位…' : '使用当前位置';
  el('locate-status').textContent = s.locationError ? friendlyError(s.locationError) : s.locating ? '不会影响随机餐食。' : center ? `搜索中心：${center.name}` : '';
  el('confirm-center').hidden = !confirmation;
  if (confirmation) el('confirm-description').textContent = `${center.name}（${center.lng.toFixed(5)}, ${center.lat.toFixed(5)}）。${center.accuracy > 0 ? `定位精度约 ${Math.round(center.accuracy)} 米。` : '定位精度未知。'}可以确认以此点为圆心搜索，或在下方选择更准确的地点。`;
}
function renderResults(s) {
  el('nearby').hidden = !s.opened;
  if (!s.opened) { el('restaurants').replaceChildren(); lastResults = null; lastStatusKey = null; return; }
  el('search-context').textContent = `${s.food?.name || ''} · 搜索中心：${s.center?.name || '待设置'} · 直线半径 ${radiusLabel(s.radius)}`;
  el('nearby').setAttribute('aria-busy', String(s.searchStatus === 'loading'));
  el('result-count').textContent = s.results.length ? `${s.results.length} 家` : '';
  const messages = { 'waiting-location': '先选择或确认搜索中心，餐食已为你保留。', loading: '正在查找相关门店…', empty: `${radiusLabel(s.radius)}内暂未找到相关门店`, error: friendlyError(s.error), success: s.partial ? `已找到部分门店，但尚未完成全部查询。${friendlyError(s.error)}` : '' };
  el('search-status').textContent = messages[s.searchStatus] || '';
  const statusKey = `${s.searchStatus}/${s.partial}/${s.radius}/${s.error?.code || ''}`;
  if (lastStatusKey !== statusKey) {
    lastStatusKey = statusKey; el('search-actions').replaceChildren();
    if (s.searchStatus === 'waiting-location') el('search-actions').append(action('设置位置', e => openLocation(e.currentTarget)));
    if (s.searchStatus === 'error' || s.partial) el('search-actions').append(action('重试', search));
    if (s.searchStatus === 'empty') {
      const next = RADII[RADII.indexOf(s.radius) + 1];
      el('search-actions').append(next ? action(`扩大到 ${radiusLabel(next)}`, () => controller.setRadius(next)) : action('修改位置', e => openLocation(e.currentTarget)), action('再来一次', () => controller.draw()));
    }
  }
  if (lastResults !== s.results) {
    lastResults = s.results; el('restaurants').replaceChildren();
    for (const poi of s.results) {
      const card = node('li', undefined, 'restaurant');
      if (poi.matchLevel === 'related') card.append(node('p', '同类备选，具体菜品需确认', 'related-label'));
      card.append(node('h3', poi.name));
      const distance = poi.distance < 1000 ? `${Math.round(poi.distance)}m` : `${(poi.distance / 1000).toFixed(1)}km`;
      card.append(node('p', `距搜索中心 ${distance}${poi.rating !== null ? ` · 评分 ${poi.rating.toFixed(1)}/5` : ''}`, 'restaurant-meta'));
      if (poi.address) card.append(node('p', poi.address, 'hint'));
      if (poi.hours) card.append(node('p', `营业时间：${poi.hours}`, 'hint'));
      const links = node('div', undefined, 'restaurant-actions');
      for (const [native, label, css] of [[true, '去这里', 'go-link'], [false, '高德网页版', 'web-link']]) {
        const link = node('a', label, css); link.href = navigationUrl(poi, native); link.target = '_blank'; link.rel = 'noopener noreferrer';
        link.setAttribute('aria-label', `${label}：${poi.name}`); links.append(link);
      }
      card.append(links); el('restaurants').append(card);
    }
  }
  el('navigation-note').hidden = !s.results.length;
}
function render(s) {
  renderLocation(s);
  for (const input of document.querySelectorAll('input[name="radius"]')) input.checked = Number(input.value) === s.radius;
  el('primary').disabled = s.drawing;
  el('primary').setAttribute('aria-disabled', String(s.searchStatus === 'loading'));
  el('primary').textContent = s.drawing ? '正在选…' : s.food ? '附近哪有' : '随机一下';
  el('again').hidden = !s.food || s.drawing;
  el('special-label').hidden = s.drawing || s.food?.pool !== 'special';
  document.querySelector('.decision').dataset.drawing = String(s.drawing);
  el('food-name').setAttribute('aria-hidden', String(s.drawing));
  if (s.drawing && !wasDrawing) {
    el('draw-announcement').textContent = '';
    if (!reducedMotion()) {
      let frame = 0; el('food-name').textContent = FOODS[0].name;
      animationTimer = setInterval(() => { frame = (frame + 7) % FOODS.length; el('food-name').textContent = FOODS[frame].name; }, 105);
    }
  }
  if (!s.drawing) {
    clearInterval(animationTimer); el('food-name').textContent = s.food?.name || '今天吃什么？';
    if (s.food && s.food !== lastFood) el('draw-announcement').textContent = `${s.food.pool === 'special' ? '今天吃点特别的，' : ''}${s.food.name}`;
    lastFood = s.food;
  } else lastFood = null; // 相同食物再次抽到时也播报最终结果。
  wasDrawing = s.drawing;
  renderResults(s);
}
const controller = new AppController({ service: amapService, store: createSettingsStore(), onChange: render, reducedMotion });
const places = createPlaceSearch({
  search: amapService.searchPlaces,
  onResult(results) {
    el('place-results').replaceChildren();
    for (const place of results) {
      const li = node('li'), button = node('button'); button.type = 'button';
      button.append(node('span', place.name), node('span', place.address || '请选择名称与位置相符的地点', 'hint'));
      button.addEventListener('click', () => chooseCenter({ lng: place.lng, lat: place.lat, name: place.name, source: 'manual', accuracy: null, coarse: false }));
      li.append(button); el('place-results').append(li);
    }
  },
  onStatus(status, error) {
    const messages = { idle: '', waiting: '等待输入…', loading: '正在搜索地点…', success: '选择一项作为搜索中心', empty: '暂未找到地点，试试加上城市或区县名称。', error: friendlyError(error) };
    el('place-status').textContent = messages[status];
  },
});
el('primary').addEventListener('click', () => controller.state.food ? search() : controller.draw());
el('again').addEventListener('click', () => controller.draw());
el('edit-location').addEventListener('click', e => openLocation(e.currentTarget));
el('close-location').addEventListener('click', closeLocation);
dialog.addEventListener('close', () => { places.cancel(); returnFocus?.focus(); });
dialog.addEventListener('keydown', event => {
  // 搜索输入框会吞掉 Escape；统一为关闭弹层，并明确约束 Tab 焦点循环。
  if (event.key === 'Escape') { event.preventDefault(); closeLocation(); return; }
  if (event.key !== 'Tab') return;
  const focusable = [...dialog.querySelectorAll('button:not(:disabled), input:not(:disabled), a[href]')].filter(n => n.getClientRects().length > 0);
  const first = focusable[0], last = focusable.at(-1);
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
}, true);
function keepFocusedFieldVisible() {
  if (dialog.open && dialog.contains(document.activeElement)) requestAnimationFrame(() => document.activeElement.scrollIntoView({ block: 'nearest' }));
}
window.visualViewport?.addEventListener('resize', keepFocusedFieldVisible);
window.addEventListener('resize', keepFocusedFieldVisible);
el('locate').addEventListener('click', () => { closeAfterLocate = true; void controller.locate(); });
el('retry-location').addEventListener('click', () => controller.locate());
el('accept-center').addEventListener('click', () => chooseCenter({ ...controller.state.center, source: 'confirmed' }));
for (const input of document.querySelectorAll('input[name="radius"]')) input.addEventListener('change', () => {
  controller.setRadius(Number(input.value));
  if (controller.state.searchStatus === 'waiting-location') openLocation(input);
});
let composing = false;
el('place-query').addEventListener('compositionstart', () => { composing = true; places.cancel(); });
el('place-query').addEventListener('compositionend', e => { composing = false; places.update(e.target.value); });
el('place-query').addEventListener('input', e => { if (!composing) places.update(e.target.value); });
window.addEventListener('offline', () => {
  places.cancel();
  if (dialog.open) el('place-status').textContent = friendlyError(new ServiceError('OFFLINE'));
  if (controller.state.opened && controller.state.food) void controller.search();
});
window.addEventListener('pagehide', () => { clearInterval(animationTimer); places.cancel(); });
render(controller.state);
// 浏览器保有权限决定权；每次页面加载只尝试一次，拒绝后不循环重试。
void controller.locate({ automatic: true });
void requestJSON('/api/config').then(value => {
  config = value;
  if (value.pwaEnabled && 'serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
}).catch(() => {});
