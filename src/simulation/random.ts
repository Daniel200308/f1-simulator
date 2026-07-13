export function hashNoise(seed: number, stream: number, tick: number): number {
  let value = (seed ^ Math.imul(stream + 1, 0x9e3779b1) ^ Math.imul(tick + 1, 0x85ebca6b)) >>> 0;
  value ^= value >>> 16;
  value = Math.imul(value, 0x7feb352d);
  value ^= value >>> 15;
  value = Math.imul(value, 0x846ca68b);
  value ^= value >>> 16;
  return (value >>> 0) / 4_294_967_296;
}

export function signedNoise(seed: number, stream: number, tick: number): number {
  return hashNoise(seed, stream, tick) * 2 - 1;
}
