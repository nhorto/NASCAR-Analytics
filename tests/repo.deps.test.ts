// Dependency invariants (WS-I). Wrangler is the one tool that performs the
// deploy, and after D18 it runs on the production server rather than in CI —
// so it must be a pinned, already-present binary, not something fetched from
// the registry mid-refresh at whatever version happens to be latest.
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
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
    // The site server runs on a Railway container with the db on a volume; every
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

describe("mobile feature modules stay Node-runnable", () => {
  // The root `bun test` walks mobile/ too, but the repo deliberately keeps
  // mobile's node_modules separate (WS-J: no workspace). So anything reachable
  // from a feature's `api.ts`/`model.ts` that imports React makes its colocated
  // parser tests die with "Cannot find package 'react'" at the root run — which
  // is how this invariant got broken once (a hook was added to stats/api.ts,
  // then again one level deeper when the hook moved to a lib module the api
  // still imported). React belongs in screens and in the lib/use*.ts hooks,
  // which no Node-runnable module imports.
  const NATIVE_ONLY = /from\s+"(react|react-native|expo(-[\w-]+)?|@react-native[\w/-]*|react-native-[\w-]+)"/;
  const MOBILE_SRC = ROOT + "mobile/src/";

  /** Every local .ts/.tsx module reachable from `entry`, entry included. */
  function importClosure(entry: string): string[] {
    const seen = new Set<string>();
    const queue = [entry];
    while (queue.length > 0) {
      const current = queue.pop()!;
      if (seen.has(current)) continue;
      seen.add(current);
      const source = readFileSync(current, "utf8");
      for (const match of source.matchAll(/from\s+"(\.[^"]+)"/g)) {
        // resolve(), not new URL() — the checkout path can contain spaces,
        // which URL percent-encodes into a path that never exists, silently
        // emptying the closure and making every assertion below vacuous.
        const resolved = resolve(dirname(current), match[1]!);
        if (existsSync(resolved)) queue.push(resolved);
      }
    }
    return [...seen];
  }

  const entries = [
    ...new Bun.Glob("features/*/{api,model}.ts").scanSync({ cwd: MOBILE_SRC, absolute: true }),
  ].sort();

  test("there are feature modules to check", () => {
    // A glob that silently matches nothing would make every assertion below vacuous.
    expect(entries.length).toBeGreaterThan(4);
  });

  for (const entry of entries) {
    const name = entry.slice(MOBILE_SRC.length);
    test(`${name} reaches no React/React Native import`, () => {
      const offenders = importClosure(entry)
        .filter((file) => NATIVE_ONLY.test(readFileSync(file, "utf8")))
        .map((file) => file.slice(MOBILE_SRC.length));
      expect(offenders).toEqual([]);
    });
  }
});
