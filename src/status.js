"use strict";

/**
 * Tiny helper so the agent can update a run's status from the shell:
 *
 *   node src/status.js <runId> <state> <progress> <message...>
 *
 * Example:
 *   node src/status.js abc reading 22 "Reading resume and job inputs"
 *
 * It merges into runs/<id>/status.json (creating nothing else). Use it at each
 * stage so the browser progress bar reflects what you're doing.
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");

const [, , runId, stateArg, progressArg, ...rest] = process.argv;

if (!runId || !stateArg) {
  console.error('usage: node src/status.js <runId> <state> <progress> "message"');
  process.exit(1);
}

const statusPath = path.join(ROOT, "runs", runId, "status.json");
let status = {};
if (fs.existsSync(statusPath)) {
  try {
    status = JSON.parse(fs.readFileSync(statusPath, "utf8"));
  } catch (_) {
    status = {};
  }
}

status.runId = runId;
status.state = stateArg;
status.step = stateArg;
if (progressArg !== undefined && !Number.isNaN(Number(progressArg))) {
  status.progress = Number(progressArg);
}
if (rest.length) status.message = rest.join(" ");
status.updatedAt = Date.now();

fs.mkdirSync(path.dirname(statusPath), { recursive: true });
fs.writeFileSync(statusPath, JSON.stringify(status, null, 2));
console.log(`status[${runId}] -> ${stateArg} ${status.progress ?? ""} ${status.message || ""}`);
