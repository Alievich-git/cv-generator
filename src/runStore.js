"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

function newRunId() {
  return Date.now().toString(36) + "-" + crypto.randomBytes(3).toString("hex");
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (_) {
    return null;
  }
}

function runTimestamp(status) {
  const updated = Number(status && status.updatedAt);
  if (Number.isFinite(updated) && updated > 0) return updated;
  const created = Number(status && status.createdAt);
  if (Number.isFinite(created) && created > 0) return created;
  return 0;
}

function latestRunSummary(runsDir) {
  let entries = [];
  try {
    entries = fs.readdirSync(runsDir);
  } catch (_) {
    return null;
  }

  const candidates = [];
  for (const id of entries) {
    const runDir = path.join(runsDir, id);
    try {
      if (!fs.statSync(runDir).isDirectory()) continue;
    } catch (_) {
      continue;
    }

    const status = readJson(path.join(runDir, "status.json"));
    if (!status || typeof status !== "object") continue;
    candidates.push({
      runId: status.runId || id,
      status,
      timestamp: runTimestamp(status),
    });
  }

  if (!candidates.length) return null;
  candidates.sort((a, b) => b.timestamp - a.timestamp || String(b.runId).localeCompare(String(a.runId)));
  const latest = candidates[0];
  return { runId: latest.runId, status: latest.status };
}

function createRunScaffold(runsDir, options = {}) {
  const runId = options.runId || newRunId();
  const runDir = path.join(runsDir, runId);
  const now = Date.now();

  fs.mkdirSync(path.join(runDir, "inputs", "screenshots"), { recursive: true });
  fs.mkdirSync(path.join(runDir, "work"), { recursive: true });
  fs.mkdirSync(path.join(runDir, "output"), { recursive: true });
  fs.mkdirSync(path.join(runDir, "chat"), { recursive: true });

  const status = {
    runId,
    state: "created",
    step: "created",
    progress: 5,
    message: "Created. Continue in your IDE chat.",
    hasResume: false,
    hasJob: false,
    screenshots: 0,
    resumeFilename: null,
    createdAt: now,
    updatedAt: now,
    atsScore: null,
  };
  fs.writeFileSync(path.join(runDir, "status.json"), JSON.stringify(status, null, 2));

  const runOptions = {
    accentColor: options.accentColor || "#1f4d7a",
    pageSize: options.pageSize === "A4" ? "A4" : "Letter",
    targetScore: Number.isFinite(Number(options.targetScore)) ? Number(options.targetScore) : 90,
  };
  fs.writeFileSync(path.join(runDir, "options.json"), JSON.stringify(runOptions, null, 2));

  return { runId, runDir, status, options: runOptions };
}

module.exports = {
  createRunScaffold,
  latestRunSummary,
};
