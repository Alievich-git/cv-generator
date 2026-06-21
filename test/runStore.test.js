const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { createRunScaffold, latestRunSummary } = require("../src/runStore");

function writeStatus(root, id, status) {
  const dir = path.join(root, id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "status.json"), JSON.stringify(status, null, 2));
}

test("latestRunSummary returns null when no valid runs exist", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cvgen-runs-"));
  fs.mkdirSync(path.join(root, "not-a-run"));

  assert.equal(latestRunSummary(root), null);
});

test("latestRunSummary selects the newest run by updatedAt then createdAt", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cvgen-runs-"));
  writeStatus(root, "older", {
    runId: "older",
    state: "done",
    createdAt: 100,
    updatedAt: 200,
  });
  writeStatus(root, "newer", {
    runId: "newer",
    state: "tailoring",
    createdAt: 300,
  });

  assert.deepEqual(latestRunSummary(root), {
    runId: "newer",
    status: {
      runId: "newer",
      state: "tailoring",
      createdAt: 300,
    },
  });
});

test("createRunScaffold creates the files an IDE agent needs to start a run", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cvgen-runs-"));
  const result = createRunScaffold(root, {
    accentColor: "#123456",
    pageSize: "A4",
    targetScore: 92,
  });

  assert.match(result.runId, /^[a-z0-9-]+$/);
  assert.equal(fs.existsSync(path.join(root, result.runId, "inputs", "screenshots")), true);
  assert.equal(fs.existsSync(path.join(root, result.runId, "work")), true);
  assert.equal(fs.existsSync(path.join(root, result.runId, "output")), true);

  const status = JSON.parse(fs.readFileSync(path.join(root, result.runId, "status.json"), "utf8"));
  assert.equal(status.state, "created");
  assert.equal(status.progress, 5);

  const options = JSON.parse(fs.readFileSync(path.join(root, result.runId, "options.json"), "utf8"));
  assert.deepEqual(options, {
    accentColor: "#123456",
    pageSize: "A4",
    targetScore: 92,
  });
});
