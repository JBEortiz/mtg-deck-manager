import { mkdtempSync, rmSync } from "node:fs";
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

let cleanedUp = false;
function cleanupTempDir() {
  if (cleanedUp) {
    return;
  }

  cleanedUp = true;
  try {
    rmSync(tempDir, { recursive: true, force: true });
  } catch {
    // Temp cleanup is best-effort only.
  }
}

const child = spawn(command, commandArgs, {
  stdio: "inherit",
  shell: process.platform === "win32",
  env: {
    ...process.env,
    MTG_DB_PATH: dbPath
  }
});

const forwardSignal = (signal) => {
  if (!child.killed) {
    child.kill(signal);
  }
};

for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(signal, () => forwardSignal(signal));
}

child.on("error", (error) => {
  cleanupTempDir();
  console.error(error);
  process.exit(1);
});

child.on("exit", (code, signal) => {
  cleanupTempDir();
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 1);
});