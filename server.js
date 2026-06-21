"use strict";

/**
 * CV Generator - local I/O server.
 *
 * This server is intentionally "dumb": it only collects inputs and serves
 * outputs. The actual intelligence (reading screenshots, tailoring the
 * resume, scoring, rendering) is performed by the Cursor IDE agent, which
 * polls the runs/ folder, processes a submitted job, and writes the results
 * back. See AGENTS.md for the agent-side protocol.
 */

const express = require("express");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { extractText } = require("./src/extract");
const { latestRunSummary } = require("./src/runStore");

const ROOT = __dirname;
const RUNS = path.join(ROOT, "runs");
const REQUESTED_PORT = Number(process.env.PORT || 3333);
const START_PORT = Number.isFinite(REQUESTED_PORT) && REQUESTED_PORT > 0 ? REQUESTED_PORT : 3333;

fs.mkdirSync(RUNS, { recursive: true });

const app = express();
app.use(express.json({ limit: "4mb" }));
app.use(express.static(path.join(ROOT, "public")));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024, files: 12 },
});

// ---------------------------------------------------------------- helpers
function newRunId() {
  return Date.now().toString(36) + "-" + crypto.randomBytes(3).toString("hex");
}

function safeId(id) {
  return String(id || "").replace(/[^a-z0-9-]/gi, "");
}

function sanitizeFilename(name) {
  return String(name || "file").replace(/[^a-z0-9._-]/gi, "_").slice(-80);
}

function sanitizeColor(c) {
  if (typeof c === "string" && /^#?[0-9a-f]{3,8}$/i.test(c.trim())) {
    const v = c.trim();
    return v.startsWith("#") ? v : "#" + v;
  }
  return null;
}

function writeStatus(runDir, status) {
  status.updatedAt = Date.now();
  fs.writeFileSync(path.join(runDir, "status.json"), JSON.stringify(status, null, 2));
}

function readStatus(runDir) {
  return JSON.parse(fs.readFileSync(path.join(runDir, "status.json"), "utf8"));
}

function assembleJob(job) {
  const lines = ["# Target Job", ""];
  if (job.title) lines.push("Title: " + job.title);
  if (job.company) lines.push("Company: " + job.company);
  lines.push("");
  const sections = [
    ["Job Description", job.description],
    ["Requirements / Qualifications", job.requirements],
    ["Responsibilities", job.responsibilities],
    ["About the Company", job.about],
  ];
  for (const [heading, body] of sections) {
    if (body && body.trim()) {
      lines.push(`## ${heading}`, body.trim(), "");
    }
  }
  return lines.join("\n").trim() + "\n";
}

function sendRunFile(res, id, rel, contentType) {
  const runDir = path.join(RUNS, safeId(id));
  const file = path.join(runDir, rel);
  if (!file.startsWith(runDir) || !fs.existsSync(file)) {
    return res.status(404).json({ error: "not found" });
  }
  if (contentType) res.type(contentType);
  res.sendFile(file);
}

// ---------------------------------------------------------------- chat I/O
// The chat is how the user and the agent collaborate after the first draft:
// the agent asks enhancement questions, the user replies or requests edits,
// and the agent applies them live. Protocol (files only, no AI in this server):
//   runs/<id>/chat/thread.json     full conversation (the AGENT writes this)
//   runs/<id>/chat/inbox/*.json    user messages waiting to be processed
function chatDir(id) {
  return path.join(RUNS, safeId(id), "chat");
}
function readThread(id) {
  try {
    return JSON.parse(fs.readFileSync(path.join(chatDir(id), "thread.json"), "utf8"));
  } catch (_) {
    return [];
  }
}
function readInbox(id) {
  const dir = path.join(chatDir(id), "inbox");
  try {
    return fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".json"))
      .sort()
      .map((f) => {
        try {
          return JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
        } catch (_) {
          return null;
        }
      })
      .filter(Boolean);
  } catch (_) {
    return [];
  }
}
function previewVersion(id) {
  try {
    return Math.floor(fs.statSync(path.join(RUNS, safeId(id), "output", "resume.html")).mtimeMs);
  } catch (_) {
    return 0;
  }
}

// ---------------------------------------------------------------- routes
app.post(
  "/api/run",
  upload.fields([
    { name: "resume", maxCount: 1 },
    { name: "screenshots", maxCount: 10 },
  ]),
  async (req, res) => {
    try {
      const runId = newRunId();
      const runDir = path.join(RUNS, runId);
      const inputs = path.join(runDir, "inputs");
      const shotsDir = path.join(inputs, "screenshots");
      fs.mkdirSync(shotsDir, { recursive: true });
      fs.mkdirSync(path.join(runDir, "work"), { recursive: true });

      // --- resume (file upload OR pasted text) ---
      const resumeFile = req.files && req.files.resume && req.files.resume[0];
      let resumeText = (req.body.resumeText || "").trim();
      let resumeFilename = null;
      if (resumeFile) {
        resumeFilename = sanitizeFilename(resumeFile.originalname);
        const ext = (path.extname(resumeFilename) || ".bin").toLowerCase();
        const dest = path.join(inputs, "resume" + ext);
        fs.writeFileSync(dest, resumeFile.buffer);
        try {
          resumeText = await extractText(dest);
        } catch (e) {
          console.error("resume extraction failed:", e.message);
        }
      }
      fs.writeFileSync(path.join(inputs, "resume.txt"), resumeText || "");

      // --- screenshots ---
      const shots = (req.files && req.files.screenshots) || [];
      const shotPaths = [];
      shots.forEach((f, i) => {
        let ext = (path.extname(f.originalname) || ".png").toLowerCase();
        if (!/^\.(png|jpg|jpeg|webp|gif)$/.test(ext)) ext = ".png";
        const name = `shot_${i + 1}${ext}`;
        fs.writeFileSync(path.join(shotsDir, name), f.buffer);
        shotPaths.push("inputs/screenshots/" + name);
      });

      // --- job text ---
      const job = {
        title: (req.body.jobTitle || "").trim(),
        company: (req.body.companyName || "").trim(),
        description: (req.body.jobDescription || "").trim(),
        requirements: (req.body.requirements || "").trim(),
        responsibilities: (req.body.responsibilities || "").trim(),
        about: (req.body.aboutCompany || "").trim(),
      };
      fs.writeFileSync(path.join(inputs, "job.txt"), assembleJob(job));
      fs.writeFileSync(path.join(inputs, "job.json"), JSON.stringify(job, null, 2));

      // --- options ---
      const options = {
        accentColor: sanitizeColor(req.body.accentColor) || "#1f4d7a",
        pageSize: req.body.pageSize === "A4" ? "A4" : "Letter",
        targetScore: 90,
      };
      fs.writeFileSync(path.join(runDir, "options.json"), JSON.stringify(options, null, 2));

      const hasJob =
        !!(job.title || job.company || job.description || job.requirements ||
          job.responsibilities || job.about) || shotPaths.length > 0;

      const status = {
        runId,
        state: "submitted",
        step: "submitted",
        progress: 5,
        message: "Submitted. Waiting for the Cursor agent to pick up this job…",
        hasResume: !!(resumeText && resumeText.trim().length > 30),
        hasJob,
        screenshots: shotPaths.length,
        resumeFilename,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        atsScore: null,
      };
      writeStatus(runDir, status);
      fs.writeFileSync(path.join(runDir, "SUBMITTED"), new Date().toISOString());

      res.json({ runId, status });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: String((e && e.message) || e) });
    }
  }
);

app.get("/api/status/:id", (req, res) => {
  const runDir = path.join(RUNS, safeId(req.params.id));
  if (!fs.existsSync(path.join(runDir, "status.json"))) {
    return res.status(404).json({ error: "run not found" });
  }
  let status;
  try {
    status = readStatus(runDir);
  } catch (e) {
    return res.status(503).json({ error: "status updating, retry" });
  }
  const reportPath = path.join(runDir, "output", "report.json");
  if (fs.existsSync(reportPath)) {
    try {
      status.report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
    } catch (_) {}
  }
  status.pdfReady = fs.existsSync(path.join(runDir, "output", "resume.pdf"));
  status.htmlReady = fs.existsSync(path.join(runDir, "output", "resume.html"));
  status.previewVersion = previewVersion(req.params.id);
  res.json(status);
});

app.get("/api/output/:id/resume.pdf", (req, res) =>
  sendRunFile(res, req.params.id, "output/resume.pdf", "application/pdf")
);
app.get("/api/output/:id/resume.html", (req, res) =>
  sendRunFile(res, req.params.id, "output/resume.html", "text/html")
);
app.get("/api/output/:id/report.json", (req, res) =>
  sendRunFile(res, req.params.id, "output/report.json", "application/json")
);

// --- chat: the user posts a message; the agent picks it up from the inbox ---
app.post("/api/chat/:id", (req, res) => {
  const id = safeId(req.params.id);
  const runDir = path.join(RUNS, id);
  if (!fs.existsSync(runDir)) return res.status(404).json({ error: "run not found" });
  const text = String((req.body && req.body.text) || "").trim();
  if (!text) return res.status(400).json({ error: "empty message" });
  if (text.length > 4000) return res.status(400).json({ error: "message too long" });
  const inbox = path.join(runDir, "chat", "inbox");
  fs.mkdirSync(inbox, { recursive: true });
  const msg = { id: newRunId(), role: "user", text, ts: Date.now() };
  const fname = `${Date.now().toString(36)}-${crypto.randomBytes(2).toString("hex")}.json`;
  fs.writeFileSync(path.join(inbox, fname), JSON.stringify(msg, null, 2));
  res.json({ ok: true, message: msg });
});

// --- chat: the browser polls this for the whole conversation + live signals ---
app.get("/api/chat/:id", (req, res) => {
  const id = safeId(req.params.id);
  const runDir = path.join(RUNS, id);
  if (!fs.existsSync(runDir)) return res.status(404).json({ error: "run not found" });
  const messages = readThread(id);
  const pending = readInbox(id).map((m) => ({ role: "user", text: m.text, ts: m.ts, pending: true }));
  const lastIsUser = messages.length > 0 && messages[messages.length - 1].role === "user";
  let report = null;
  try {
    report = JSON.parse(fs.readFileSync(path.join(runDir, "output", "report.json"), "utf8"));
  } catch (_) {}
  res.json({
    messages,
    pending,
    thinking: pending.length > 0 || lastIsUser,
    previewVersion: previewVersion(id),
    report,
  });
});

// For the agent (and for debugging): list runs that still need processing.
app.get("/api/pending", (req, res) => {
  let pending = [];
  try {
    pending = fs
      .readdirSync(RUNS)
      .filter((d) => fs.existsSync(path.join(RUNS, d, "SUBMITTED")))
      .filter((d) => !fs.existsSync(path.join(RUNS, d, "output", "resume.pdf")));
  } catch (_) {}
  res.json({ pending });
});

app.get("/api/runs/latest", (req, res) => {
  const latest = latestRunSummary(RUNS);
  if (!latest) return res.status(404).json({ error: "no runs found" });
  res.json(latest);
});

let activePort = START_PORT;
app.get("/api/health", (req, res) => res.json({ ok: true, port: activePort }));

function listen(port, attemptsLeft = 10) {
  const server = app.listen(port, () => {
    activePort = port;
    console.log(`\n  CV Generator dashboard:  http://localhost:${port}\n`);
    console.log("  Keep this server open for live preview and reports. Do the AI chat in your IDE.\n");
  });

  server.on("error", (err) => {
    if (err && err.code === "EADDRINUSE" && attemptsLeft > 0) {
      console.warn(`  Port ${port} is busy, trying ${port + 1}...`);
      listen(port + 1, attemptsLeft - 1);
      return;
    }
    throw err;
  });
}

listen(START_PORT);
