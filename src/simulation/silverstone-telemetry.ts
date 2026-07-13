// Distance/speed profile sampled at ~50 m from zvanjak/MML's
// f1_silverstone_lap.csv (MIT, copyright Zvonimir Vanjak).
// Source distance (5818.876 m) is normalized to the 5891 m game circuit.
export const SILVERSTONE_REFERENCE_LAP_SECONDS = 89.438;
export const SILVERSTONE_TELEMETRY_SOURCE = "zvanjak/MML · f1_silverstone_lap.csv";

export const SILVERSTONE_TELEMETRY_PROFILE = [
  [0, 256.438], [55, 266.670], [109, 276.000], [156, 283.000], [207, 288.475],
  [263, 292.000], [303, 295.325], [371, 298.000], [415, 295.887], [456, 294.000],
  [506, 293.000], [555, 294.650], [609, 297.004], [655, 296.000], [705, 292.019],
  [763, 289.000], [811, 258.511], [856, 160.398], [905, 110.750], [952, 119.000],
  [1004, 121.075], [1053, 85.315], [1104, 124.000], [1150, 169.919], [1203, 204.000],
  [1260, 229.000], [1307, 241.914], [1357, 253.000], [1401, 262.770], [1463, 273.670],
  [1507, 278.725], [1563, 284.979], [1602, 288.238], [1659, 291.000], [1700, 293.000],
  [1767, 298.000], [1803, 296.269], [1863, 291.000], [1903, 256.000], [1953, 195.000],
  [2002, 163.033], [2056, 170.993], [2106, 171.000], [2154, 131.000], [2203, 114.633],
  [2253, 142.000], [2301, 183.431], [2354, 210.963], [2453, 248.000], [2456, 248.633],
  [2508, 259.000], [2553, 267.000], [2607, 276.891], [2653, 282.637], [2708, 287.580],
  [2754, 292.975], [2807, 296.317], [2852, 299.181], [2905, 301.000], [2962, 300.000],
  [3009, 299.000], [3054, 291.600], [3102, 283.637], [3164, 282.000], [3261, 286.996],
  [3316, 290.000], [3354, 293.495], [3402, 296.000], [3463, 299.000], [3507, 301.000],
  [3556, 301.494], [3602, 301.512], [3650, 297.567], [3715, 293.021], [3762, 286.216],
  [3812, 283.000], [3854, 275.508], [3902, 251.000], [3954, 239.678], [4002, 218.025],
  [4062, 216.978], [4106, 229.000], [4159, 242.000], [4201, 253.000], [4251, 262.000],
  [4311, 272.983], [4358, 279.000], [4407, 284.483], [4464, 289.000], [4503, 292.481],
  [4558, 296.113], [4610, 299.000], [4664, 301.000], [4702, 302.086], [4756, 303.992],
  [4801, 304.000], [4852, 305.000], [4906, 300.000], [4951, 294.236], [5008, 260.000],
  [5051, 235.050], [5111, 228.475], [5154, 239.000], [5201, 247.000], [5259, 260.000],
  [5319, 271.000], [5356, 276.000], [5403, 276.000], [5453, 256.846], [5500, 148.000],
  [5554, 100.000], [5604, 123.000], [5658, 154.929], [5706, 192.231], [5751, 215.000],
  [5806, 231.255], [5861, 249.179], [5891, 256.025],
] as const;

export function telemetrySpeedAtDistance(distanceMeters: number): number {
  const trackLength = SILVERSTONE_TELEMETRY_PROFILE.at(-1)![0];
  const distance = ((distanceMeters % trackLength) + trackLength) % trackLength;
  let low = 0;
  let high = SILVERSTONE_TELEMETRY_PROFILE.length - 1;
  while (low + 1 < high) {
    const middle = Math.floor((low + high) / 2);
    if (SILVERSTONE_TELEMETRY_PROFILE[middle][0] <= distance) low = middle;
    else high = middle;
  }
  const [distanceA, speedA] = SILVERSTONE_TELEMETRY_PROFILE[low];
  const [distanceB, speedB] = SILVERSTONE_TELEMETRY_PROFILE[high];
  const progress = (distance - distanceA) / Math.max(1, distanceB - distanceA);
  return speedA + (speedB - speedA) * progress;
}

export function telemetryReferenceLapTime(): number {
  let seconds = 0;
  for (let index = 1; index < SILVERSTONE_TELEMETRY_PROFILE.length; index += 1) {
    const [previousDistance, previousSpeed] = SILVERSTONE_TELEMETRY_PROFILE[index - 1];
    const [distance, speed] = SILVERSTONE_TELEMETRY_PROFILE[index];
    seconds += (distance - previousDistance) / (((previousSpeed + speed) / 2) / 3.6);
  }
  return seconds;
}
