#!/usr/bin/env node
// Tiny supervisor for the hub's HTTP server (web UI + MCP). Started detached by the
// stdio entry point when no hub is running. It restarts the server whenever a file
// under server/ changes, so connected apps never run stale code. Kept deliberately
// small: the supervisor itself is the one piece that doesn't hot-reload.

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { REPO_DIR } from "./config.mjs";

const SERVER = path.join(REPO_DIR, "server", "http.mjs");
const PORT_IN_USE = 3;
let child = null;
let restarting = false;
let crashes = 0;

function start() {
  child = spawn(process.execPath, [SERVER], { stdio: ["ignore", "ignore", "inherit"], env: process.env });
  const startedAt = Date.now();
  child.on("exit", (code) => {
    child = null;
    if (restarting) return;
    if (code === PORT_IN_USE) process.exit(0); // another hub already owns the port
    crashes = Date.now() - startedAt < 5000 ? crashes + 1 : 0;
    if (crashes > 5) process.exit(1);
    setTimeout(start, 1000);
  });
}

function restart() {
  if (!child) return start();
  restarting = true;
  child.once("exit", () => {
    restarting = false;
    start();
  });
  child.kill();
}

let timer;
fs.watch(path.join(REPO_DIR, "server"), { recursive: true }, (_, file) => {
  if (!file || !file.endsWith(".mjs")) return;
  clearTimeout(timer);
  timer = setTimeout(restart, 250);
});

for (const sig of ["SIGTERM", "SIGINT"]) process.on(sig, () => (child?.kill(), process.exit(0)));
start();
