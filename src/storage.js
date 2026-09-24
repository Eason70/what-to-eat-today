import { coordinates, RADII, numberValue, textValue } from './ranking.js';
export const STORAGE_KEY = 'what-to-eat-settings-v1';
function availableStorage() { try { return globalThis.localStorage; } catch { return null; } }
export function validateCenter(value, now = Date.now()) {
  const position = coordinates(value);
  if (!position || !['manual', 'geolocation', 'confirmed'].includes(value?.source)) return null;
  const savedAt = numberValue(value.savedAt), name = textValue(value.name, 100);
  if (!name || savedAt === null || savedAt <= 0 || savedAt > now + 60000) return null;
  const accuracy = numberValue(value.accuracy);
  return { ...position, name, source: value.source, savedAt, accuracy: accuracy !== null && accuracy > 0 ? accuracy : null, coarse: value.coarse === true };
}
export function createSettingsStore(storage = availableStorage()) {
  let memory = { radius: 1000, center: null };
  return {
    read() {
      try {
        const value = JSON.parse(storage?.getItem(STORAGE_KEY) ?? 'null');
        if (value && typeof value === 'object') memory = { radius: RADII.includes(value.radius) ? value.radius : 1000, center: validateCenter(value.center) };
      } catch { /* 无权限、损坏存储：保留内存默认值。 */ }
      return { ...memory };
    },
    save({ radius, center }) {
      memory = { radius: RADII.includes(radius) ? radius : 1000, center: validateCenter(center) };
      try { storage?.setItem(STORAGE_KEY, JSON.stringify(memory)); } catch { /* 当前会话仍然可用。 */ }
    },
  };
}
