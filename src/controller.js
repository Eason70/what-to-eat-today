import { drawFood } from './random.js';
import { needsCenterConfirmation, RADII } from './ranking.js';
import { ServiceError } from './errors.js';
// 所有可见状态变更都经过这里。AbortController + 序号双重防护不可取消的晚到响应。
export class AppController {
  constructor({ service, store, onChange = () => {}, rng = Math.random, delay = ms => new Promise(r => setTimeout(r, ms)), reducedMotion = () => false }) {
    this.service = service; this.store = store; this.onChange = onChange; this.rng = rng; this.delay = delay; this.reducedMotion = reducedMotion;
    const settings = store.read();
    this.persistedCenter = settings.center;
    this.state = { ...settings, cached: !!settings.center, food: null, drawing: false, opened: false, searchStatus: 'idle', results: [], error: null, partial: false, locating: false, locationError: null };
    this.searchRevision = 0; this.locationRevision = 0; this.autoAttempted = false;
  }
  emit() { this.onChange(this.state); }
  persist() {
    if (this.state.center && !needsCenterConfirmation(this.state.center, this.state.radius)) this.persistedCenter = this.state.center;
    this.store.save({ radius: this.state.radius, center: this.persistedCenter });
  }
  cancelSearch() { this.searchRevision++; this.searchAbort?.abort(); this.state.results = []; this.state.error = null; this.state.partial = false; }
  async draw() {
    if (this.state.drawing) return null;
    const chosen = drawFood(this.rng); // 恰好两次随机调用，动画不再抽样。
    this.cancelSearch();
    Object.assign(this.state, { drawing: true, food: null, opened: false, searchStatus: 'idle' }); this.emit();
    await this.delay(this.reducedMotion() ? 0 : 840);
    Object.assign(this.state, { drawing: false, food: chosen }); this.emit();
    return chosen;
  }
  async search() {
    if (!this.state.food || this.state.drawing) return;
    this.cancelSearch(); this.state.opened = true;
    if (!this.state.center || needsCenterConfirmation(this.state.center, this.state.radius)) {
      this.state.searchStatus = 'waiting-location'; this.emit(); return;
    }
    const revision = this.searchRevision, controller = this.searchAbort = new AbortController();
    const { food, center, radius } = this.state;
    this.state.searchStatus = 'loading'; this.emit();
    try {
      const result = await this.service.searchNearby({ food, center: { ...center }, radius, signal: controller.signal });
      if (revision !== this.searchRevision) return;
      Object.assign(this.state, { results: result.pois, partial: !!result.partial, error: result.error || null, searchStatus: result.pois.length ? 'success' : 'empty' });
    } catch (error) {
      if (revision !== this.searchRevision || error.name === 'AbortError') return;
      Object.assign(this.state, { error, searchStatus: 'error' });
    }
    if (revision === this.searchRevision) this.emit();
  }
  setRadius(radius) {
    if (!RADII.includes(radius) || radius === this.state.radius) return;
    this.state.radius = radius; this.persist();
    if (this.state.opened) void this.search(); else this.emit();
  }
  setCenter(center) {
    this.locationRevision++; // 手动选择或确认后，旧定位永远不能覆盖。
    Object.assign(this.state, { center: { ...center, savedAt: Date.now() }, cached: false, locating: false, locationError: null });
    this.persist();
    if (this.state.opened) void this.search(); else this.emit();
  }
  async locate({ automatic = false } = {}) {
    if (automatic && this.autoAttempted) return;
    if (automatic) this.autoAttempted = true;
    if (this.state.locating) return;
    const revision = ++this.locationRevision;
    this.state.locating = true; this.state.locationError = null; this.emit();
    try {
      const center = await this.service.locate({ automatic });
      if (revision !== this.locationRevision) return;
      Object.assign(this.state, { center: { ...center, savedAt: Date.now() }, cached: false, locating: false });
      // 粗略定位不覆盖最后一个可用中心的持久副本。
      if (!needsCenterConfirmation(center, this.state.radius)) this.persist();
      if (this.state.opened) void this.search(); else this.emit();
      // 地址解析和坐标成功独立；晚到地址同样需要版本保护。
      if (center.name === '当前位置' && this.service.reverseGeocode) {
        try {
          const name = await this.service.reverseGeocode(center);
          if (name && revision === this.locationRevision) { this.state.center.name = name; if (!needsCenterConfirmation(this.state.center, this.state.radius)) this.persist(); this.emit(); }
        } catch { /* 已有可用坐标，不将地址解析失败算作定位失败。 */ }
      }
    } catch (error) {
      if (revision !== this.locationRevision) return;
      this.state.locationError = error instanceof Error ? error : new ServiceError('LOCATION_FAILED');
      this.state.locating = false; this.emit();
    }
  }
}
