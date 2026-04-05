import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error("Usage: node scripts/run-with-temp-db.mjs <command> [args...]");
  process.exit(1);
}

const tempDir = mkdtempSync(path.join(os.tmpdir(), "mtg-deck-manager-temp-db-"));
const dbPath = path.join(tempDir, "mtgdeckmanager-next.sqlite");
const [command, ...commandArgs] = args;

const child = spawn(command, commandArgs, {
  stdio: "inherit",
  shell: process.platform === "win32",
  env: {
    ...process.env,
    MTG_DB_PATH: dbPath
  }
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 1);
});
