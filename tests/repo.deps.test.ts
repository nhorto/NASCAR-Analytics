// Dependency invariants (WS-I). Wrangler is the one tool that performs the
// deploy, and after D18 it runs on the production server rather than in CI —
// so it must be a pinned, already-present binary, not something fetched from
// the registry mid-refresh at whatever version happens to be latest.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (rel: string): string => readFileSync(ROOT + rel, "utf8");

const pkg = JSON.parse(read("package.json")) as {
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
};

describe("wrangler", () => {
  test("is a devDependency, so `bunx wrangler` resolves locally", () => {
    expect(Object.keys(pkg.devDependencies)).toContain("wrangler");
    expect(Object.keys(pkg.dependencies)).not.toContain("wrangler");
  });

  test("is pinned exactly — a range would let a deploy-breaking release land on a Monday", () => {
    expect(pkg.devDependencies.wrangler).toMatch(/^\d+\.\d+\.\d+$/);
  });

  test("the pinned version is in the lockfile", () => {
    expect(read("bun.lock")).toContain(`wrangler@${pkg.devDependencies.wrangler}`);
  });

  test("the deploy leg still shells out to wrangler", () => {
    // If this moves to an API client the pin above stops mattering; fail loudly
    // rather than leave a stale invariant guarding nothing.
    expect(read("src/app/index.ts")).toContain('"bunx", "wrangler"');
  });
});

describe("runtime dependencies stay minimal", () => {
  test("exactly one production dependency", () => {
    // The site server runs on a Fly machine with the db on a volume; every
    // runtime dependency is something that can break a deploy at 12:00 UTC.
    expect(Object.keys(pkg.dependencies)).toEqual(["hyparquet"]);
  });

  test("the canary workflow installs without devDependencies", () => {
    // Otherwise the daily canary pulls the pinned wrangler (~150 MB) for a job
    // that only reads NASCAR's CDN.
    expect(read(".github/workflows/canary.yml")).toContain(
      "bun install --frozen-lockfile --production",
    );
  });
});
