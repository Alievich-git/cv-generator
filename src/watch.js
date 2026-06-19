"use strict";

/**
 * Event watcher for the agent's worker loop. Blocks until there is something
 * to do, then prints ONE event and exits so the agent can act and re-arm:
 *
 *   RUN  <id>   a freshly submitted run that needs to be tailored + rendered
 *   CHAT <id>   a run whose draft exists and that has new user chat message(s)
 *   IDLE        nothing happened before the max wait (just re-run watch)
 *
 * Run from the repo root:  node src/watch.js [maxWaitMs]
 *
 * This is what makes the experience hands-off: once the user presses Run (or
 * sends a chat message) in the web page, this returns immediately and the agent
 * processes it. The user never has to come back to the IDE.
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const RUNS = path.join(ROOT, "runs");
const MAX_MS = Number(process.argv[2] || 270000);
const POLL_MS = 1200;

function listRuns() {
  try {
    return fs
      .readdirSync(RUNS)
      .filter((d) => fs.statSync(path.join(RUNS, d)).isDirectory())
      .filter((d) => fs.existsSync(path.join(RUNS, d, "status.json")) || fs.existsSync(path.join(RUNS, d, "SUBMITTED")));
  } catch (_) {
    return [];
  }
}
function stateOf(id) {
  try {
    return JSON.parse(fs.readFileSync(path.join(RUNS, id, "status.json"), "utf8")).state || "";
  } catch (_) {
    return "";
  }
}
function inboxCount(id) {
  try {
    return fs.readdirSync(path.join(RUNS, id, "chat", "inbox")).filter((f) => f.endsWith(".json")).length;
  } catch (_) {
    return 0;
  }
}
function nextEvent() {
  for (const id of listRuns()) {
    const hasPdf = fs.existsSync(path.join(RUNS, id, "output", "resume.pdf"));
    const hasHtml = fs.existsSync(path.join(RUNS, id, "output", "resume.html"));
    const submitted = fs.existsSync(path.join(RUNS, id, "SUBMITTED"));
    if (submitted && !hasPdf && stateOf(id) === "submitted") return "RUN " + id;
    if (hasHtml && inboxCount(id) > 0) return "CHAT " + id;
  }
  return null;
}

const started = Date.now();
(function loop() {
  const ev = nextEvent();
  if (ev) {
    console.log(ev);
    process.exit(0);
  }
  if (Date.now() - started > MAX_MS) {
    console.log("IDLE");
    process.exit(0);
  }
  setTimeout(loop, POLL_MS);
})();
