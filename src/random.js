import { EVERYDAY, SPECIAL } from './food-data.js';
function unit(rng) {
  const n = rng();
  if (!Number.isFinite(n) || n < 0 || n >= 1) throw new RangeError('随机源必须返回 [0, 1) 内的数');
  return n;
}
export function drawFood(rng = Math.random) {
  const pool = unit(rng) < 0.95 ? EVERYDAY : SPECIAL;
  return pool[Math.floor(unit(rng) * pool.length)];
}
