// Enforces the DDD layer rules from ARCHITECTURE.md:
//   Utils → Types → Providers → Domains → App
//   Within a domain: Types → Config → Repo → Service → Runtime → UI
//   Cross-domain: type imports only. Runtime may not import Repo.
//   Types have zero runtime imports. Config has no external imports.
import { describe, expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { join, dirname, resolve, relative, sep } from "node:path";

const SRC = resolve(import.meta.dir, "../src");

type Layer =
  | "utils"
  | "providers"
  | "app"
  | "types"
  | "config"
  | "repo"
  | "service"
  | "runtime"
  | "ui"
  | "barrel";

interface SourceFile {
  path: string; // relative to src, posix-style
  layer: Layer;
  domain: string | null;
  content: string;
}

function walk(dir: string): string[] {
  return readdirSync(dir, { recursive: true, encoding: "utf8" })
    .map((p) => p.split(sep).join("/"))
    .filter((p) => p.endsWith(".ts"));
}

function classify(relPath: string): { layer: Layer; domain: string | null } {
  const parts = relPath.split("/");
  if (parts[0] === "utils") return { layer: "utils", domain: null };
  if (parts[0] === "providers") return { layer: "providers", domain: null };
  if (parts[0] === "app") return { layer: "app", domain: null };
  if (parts[0] === "domains") {
    const domain = parts[1] ?? "";
    const file = parts[2] ?? "";
    if (file === "types.ts") return { layer: "types", domain };
    if (file === "config.ts") return { layer: "config", domain };
    if (file === "repo.ts" || parts[2] === "repo") return { layer: "repo", domain };
    if (file === "service.ts" || parts[2] === "service") return { layer: "service", domain };
    if (file === "runtime.ts" || parts[2] === "runtime") return { layer: "runtime", domain };
    if (parts[2] === "ui") return { layer: "ui", domain };
    if (file === "index.ts") return { layer: "barrel", domain };
  }
  throw new Error(`Unclassifiable source file: src/${relPath}`);
}

function loadSources(): SourceFile[] {
  return walk(SRC).map((relPath) => ({
    path: relPath,
    ...classify(relPath),
    content: readFileSyncUtf8(join(SRC, relPath)),
  }));
}

function readFileSyncUtf8(path: string): string {
  return require("node:fs").readFileSync(path, "utf8") as string;
}

/** All module specifiers referenced via `from "..."` or bare `import "..."`. */
function importSpecifiers(content: string): string[] {
  const specs: string[] = [];
  for (const m of content.matchAll(/\bfrom\s+["']([^"']+)["']/g)) specs.push(m[1]!);
  for (const m of content.matchAll(/^import\s+["']([^"']+)["']/gm)) specs.push(m[1]!);
  return specs;
}

function isExternal(spec: string): boolean {
  return !spec.startsWith("./") && !spec.startsWith("../");
}

function resolveTarget(sourcePath: string, spec: string): { layer: Layer; domain: string | null } {
  const abs = resolve(SRC, dirname(sourcePath), spec);
  const rel = relative(SRC, abs).split(sep).join("/");
  return classify(rel);
}

// Allowed internal target layers, per source layer. Same-domain restrictions
// are checked separately below.
const ALLOWED: Record<Layer, Layer[]> = {
  utils: ["utils"],
  types: ["types", "utils"],
  config: ["types", "utils"],
  repo: ["types", "config", "providers", "utils"],
  service: ["types", "config", "repo", "providers", "utils"],
  runtime: ["types", "config", "service", "providers", "utils"],
  ui: ["types", "config"],
  barrel: ["types", "config", "repo", "service", "runtime", "ui"],
  providers: ["providers", "utils", "types"],
  app: ["utils", "providers", "types", "config", "repo", "service", "runtime", "ui", "barrel"],
};

// Layers that may not import anything external (npm packages, bun:/node: builtins).
const NO_EXTERNAL_IMPORTS: Layer[] = ["types", "config", "ui"];

const sources = loadSources();

describe("architecture", () => {
  test("source tree contains files", () => {
    expect(sources.length).toBeGreaterThan(0);
  });

  for (const file of sources) {
    describe(`src/${file.path} (${file.layer})`, () => {
      const specs = importSpecifiers(file.content);

      test("layer dependency rules", () => {
        for (const spec of specs) {
          if (isExternal(spec)) continue;
          const target = resolveTarget(file.path, spec);
          expect(
            ALLOWED[file.layer],
            `src/${file.path} (${file.layer}) may not import ${spec} (${target.layer})`,
          ).toContain(target.layer);

          // Cross-domain: only type imports are allowed.
          if (
            file.domain !== null &&
            target.domain !== null &&
            file.domain !== target.domain
          ) {
            expect(
              target.layer,
              `src/${file.path} imports non-type module from domain ${target.domain}`,
            ).toBe("types");
          }
          // Providers may reach into domains for types only.
          if (file.layer === "providers" && target.domain !== null) {
            expect(target.layer).toBe("types");
          }
        }
      });

      if (NO_EXTERNAL_IMPORTS.includes(file.layer)) {
        test("no external imports", () => {
          const externals = specs.filter(isExternal);
          expect(externals, `src/${file.path} imports externals: ${externals.join(", ")}`).toEqual(
            [],
          );
        });
      }

      if (file.layer === "types") {
        test("zero runtime imports (import type only)", () => {
          const runtimeImports = [...file.content.matchAll(/^import\s+(?!type\b)/gm)];
          expect(runtimeImports.length).toBe(0);
        });
      }
    });
  }
});
