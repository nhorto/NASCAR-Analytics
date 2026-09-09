// `expo start` rewrites mobile/tsconfig.json and drops the Expo type includes,
// which silently narrows typechecking (2026-09-09 device drive, finding #5).
// This fails loudly instead of the change riding along in a diff unnoticed.
import { describe, expect, test } from "bun:test";

const config = await Bun.file(new URL("../../../tsconfig.json", import.meta.url)).json();

describe("mobile tsconfig", () => {
  test("keeps the Expo type includes that `expo start` strips", () => {
    expect(config.include).toContain("src");
    expect(config.include).toContain("expo-env.d.ts");
    expect(config.include).toContain(".expo/types/**/*.ts");
  });

  test("still typechecks strictly", () => {
    expect(config.compilerOptions.strict).toBe(true);
    expect(config.compilerOptions.noUncheckedIndexedAccess).toBe(true);
  });
});
