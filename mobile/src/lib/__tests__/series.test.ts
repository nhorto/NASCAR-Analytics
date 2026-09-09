import { describe, expect, test } from "bun:test";
import { SERIES, seriesRequiresPro } from "../series.tsx";

describe("series gating", () => {
  test("Cup is free, Xfinity and Trucks require Pro", () => {
    expect(seriesRequiresPro(1)).toBe(false);
    expect(seriesRequiresPro(2)).toBe(true);
    expect(seriesRequiresPro(3)).toBe(true);
  });

  test("the three national series are defined with short labels", () => {
    expect(SERIES.map((s) => s.id)).toEqual([1, 2, 3]);
    expect(SERIES.map((s) => s.short)).toEqual(["Cup", "Xfinity", "Trucks"]);
  });
});
