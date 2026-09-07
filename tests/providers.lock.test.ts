// Advisory locks: contention, self-renewal, TTL takeover, holder-checked release.
import { describe, expect, test } from "bun:test";
import { acquireLock, releaseLock } from "../src/providers/lock.ts";
import { testDb } from "./seed.ts";

const TTL = 60_000;

describe("advisory lock", () => {
  test("acquire then release", () => {
    const db = testDb();
    expect(acquireLock(db, "job", "a", TTL, 1000)).toBe(true);
    expect(releaseLock(db, "job", "a")).toBe(true);
    // Released — a different holder can take it.
    expect(acquireLock(db, "job", "b", TTL, 2000)).toBe(true);
  });

  test("a second holder cannot take a live lock", () => {
    const db = testDb();
    expect(acquireLock(db, "job", "a", TTL, 1000)).toBe(true);
    expect(acquireLock(db, "job", "b", TTL, 1000)).toBe(false);
  });

  test("the same holder re-acquires (renews) its own lock", () => {
    const db = testDb();
    expect(acquireLock(db, "job", "a", TTL, 1000)).toBe(true);
    expect(acquireLock(db, "job", "a", TTL, 30_000)).toBe(true);
    // The renewal extended the lease: at 61s (past the original expiry) it is still held.
    expect(acquireLock(db, "job", "b", TTL, 61_000)).toBe(false);
  });

  test("an expired lock is taken over", () => {
    const db = testDb();
    expect(acquireLock(db, "job", "a", TTL, 1000)).toBe(true);
    expect(acquireLock(db, "job", "b", TTL, 1000 + TTL)).toBe(true);
    // ...and the old holder is now locked out.
    expect(acquireLock(db, "job", "a", TTL, 1000 + TTL)).toBe(false);
  });

  test("release by a non-holder fails and leaves the lock in place", () => {
    const db = testDb();
    expect(acquireLock(db, "job", "a", TTL, 1000)).toBe(true);
    expect(releaseLock(db, "job", "b")).toBe(false);
    expect(acquireLock(db, "job", "b", TTL, 2000)).toBe(false); // still held by a
  });

  test("locks are independent per name", () => {
    const db = testDb();
    expect(acquireLock(db, "job-1", "a", TTL, 1000)).toBe(true);
    expect(acquireLock(db, "job-2", "b", TTL, 1000)).toBe(true);
  });
});
