import { describe, expect, it } from "vitest";

import { hashNoise } from "@/simulation/random";

describe("hashNoise", () => {
  it("returns the same value for the same stream coordinates", () => {
    expect(hashNoise(42, 3, 100)).toBe(hashNoise(42, 3, 100));
  });

  it("separates independent streams", () => {
    expect(hashNoise(42, 3, 100)).not.toBe(hashNoise(42, 4, 100));
  });
});
