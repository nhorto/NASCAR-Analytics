// `bun run restore-drill` — prove a Litestream backup actually restores AND
// boots (WS-B acceptance: "restore drill passes from a Litestream snapshot
// into a fresh machine"). Steps: restore the replica into a temp dir, start
// the real server against it on an ephemeral port, assert /health reports a
// readable db and the home page renders, clean up. Exit 0 = drill passed.
//
// Usage: bun run restore-drill [--replica URL] [--keep]
//   --replica  Litestream replica URL (default: $LITESTREAM_REPLICA_URL)
//   --keep     keep the restored temp dir for inspection
// Requires the `litestream` binary on PATH (it is in the production image;
// locally: brew install benbjohnson/litestream/litestream).
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function argString(flag: string): string | null {
  const idx = process.argv.indexOf(flag);
  if (idx === -1) return null;
  return process.argv[idx + 1] ?? null;
}

function fail(msg: string): never {
  console.error(`✗ restore drill FAILED: ${msg}`);
  process.exit(1);
}

const replica = argString("--replica") ?? process.env.LITESTREAM_REPLICA_URL;
if (!replica) fail("no replica URL — pass --replica or set LITESTREAM_REPLICA_URL");

const keep = process.argv.includes("--keep");
const dir = mkdtempSync(join(tmpdir(), "looplab-restore-"));
const dbPath = join(dir, "nascar.db");
console.log(`▶ restoring ${replica} → ${dbPath}`);

const restore = Bun.spawn(["litestream", "restore", "-o", dbPath, replica], {
  stdout: "inherit",
  stderr: "inherit",
});
if ((await restore.exited) !== 0) fail("litestream restore exited non-zero");

const size = Bun.file(dbPath).size;
if (size < 1024) fail(`restored db is implausibly small (${size} bytes)`);
console.log(`▶ restored ${(size / 1024 / 1024).toFixed(1)} MB; booting server against it`);

const server = Bun.spawn(["bun", "src/app/index.ts", "serve", "--port", "0"], {
  env: { ...process.env, NASCAR_DATA_DIR: dir, APP_ENV: undefined, NODE_ENV: undefined },
  stdout: "pipe",
  stderr: "inherit",
});

let exitCode = 1;
try {
  // The serve command prints "Looplab running at <url>" — parse the port from it.
  const reader = server.stdout.getReader();
  const decoder = new TextDecoder();
  let banner = "";
  const deadline = Date.now() + 20_000;
  while (!banner.includes("running at") && Date.now() < deadline) {
    const { value, done } = await reader.read();
    if (done) break;
    banner += decoder.decode(value);
  }
  const url = banner.match(/running at (\S+)/)?.[1]?.replace(/\/$/, "");
  if (!url) fail("server never printed its URL (boot failed?)");

  const health = (await fetch(`${url}/health`).then((r) => r.json())) as {
    ok: boolean;
    latestSeason: number | null;
    racesWithResults: number | null;
  };
  if (!health.ok) fail("/health reports not-ok on the restored db");
  const home = await fetch(`${url}/`);
  if (home.status !== 200) fail(`home page returned ${home.status} on the restored db`);

  console.log(
    `✓ restore drill PASSED — restored db serves; latest season ${health.latestSeason} ` +
      `with ${health.racesWithResults} results-complete races`,
  );
  exitCode = 0;
} finally {
  server.kill();
  await server.exited;
  if (keep) console.log(`(kept ${dir})`);
  else rmSync(dir, { recursive: true, force: true });
}
process.exit(exitCode);
