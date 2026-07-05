import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createHash } from "node:crypto";

export interface RawArchive {
  /** Persist raw feed content; returns where it landed and its digest. */
  save(relPath: string, content: string): { path: string; sha256: string };
}

/** Archives raw CDN responses verbatim under a root directory. The archive is
 * the insurance policy against the (unofficial) CDN ever going away. */
export function createRawArchive(rootDir: string): RawArchive {
  return {
    save(relPath: string, content: string) {
      const path = join(rootDir, relPath);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, content);
      const sha256 = createHash("sha256").update(content).digest("hex");
      return { path, sha256 };
    },
  };
}

/** No-op archive for tests. */
export function createNullArchive(): RawArchive {
  return {
    save(relPath: string, content: string) {
      const sha256 = createHash("sha256").update(content).digest("hex");
      return { path: relPath, sha256 };
    },
  };
}
