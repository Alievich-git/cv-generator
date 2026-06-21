"use strict";

const $ = (id) => document.getElementById(id);

const state = {
  runId: null,
  poll: null,
  chatPoll: null,
  previewVersion: -1,
  lastReportSig: "",
  scoreShown: null,
};

const LS_KEY = "cvgen.lastRun";

function showView(name) {
  $("inputView").classList.toggle("hidden", name !== "input");
  $("statusView").classList.toggle("hidden", name !== "status");
  $("reviewView").classList.toggle("hidden", name !== "review");
}

async function fetchJson(url) {
  const response = await fetch(url);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || response.statusText);
  return data;
}

async function resolveInitialRun() {
  const params = new URLSearchParams(location.search);
  const fromUrl = params.get("run");
  if (fromUrl) return fromUrl;

  try {
    const fromStorage = localStorage.getItem(LS_KEY);
    if (fromStorage) return fromStorage;
  } catch (_) {}

  try {
    const latest = await fetchJson("/api/runs/latest");
    return latest.runId || (latest.status && latest.status.runId) || null;
  } catch (_) {
    return null;
  }
}

async function loadRun(id) {
  if (!id) {
    showView("input");
    return false;
  }

  let status;
  try {
    status = await fetchJson(`/api/status/${encodeURIComponent(id)}`);
  } catch (_) {
    showView("input");
    return false;
  }

  state.runId = id;
  try {
    localStorage.setItem(LS_KEY, id);
  } catch (_) {}

  if (status.state === "done") {
    enterReview(status);
  } else {
    showView("status");
    updateStatus(status);
    startStatusPolling();
  }
  return true;
}

function startStatusPolling() {
  clearInterval(state.poll);
  state.poll = setInterval(tickStatus, 1500);
}

async function tickStatus() {
  if (!state.runId) return;
  try {
    const status = await fetchJson(`/api/status/${encodeURIComponent(state.runId)}`);
    updateStatus(status);
    if (status.state === "done") {
      clearInterval(state.poll);
      enterReview(status);
    }
  } catch (_) {}
}

function updateStatus(status) {
  const progress = typeof status.progress === "number" ? status.progress : progressFor(status.state);
  $("progressBar").style.width = Math.max(4, Math.min(100, progress)) + "%";
  $("statusMsg").textContent = status.message || "";

  if (status.state === "error") {
    $("statusSpin").classList.add("hidden");
    $("stepLabel").textContent = "Needs IDE attention";
    $("stepLabel").classList.add("text-rose-300");
    return;
  }

  $("statusSpin").classList.remove("hidden");
  $("stepLabel").classList.remove("text-rose-300");
  $("stepLabel").textContent = labelFor(status.step || status.state);
}

function progressFor(step) {
  const map = {
    created: 5,
    submitted: 6,
    reading: 22,
    analyzing: 40,
    tailoring: 58,
    scoring: 74,
    revising: 80,
    rendering: 90,
    done: 100,
  };
  return map[step] || 10;
}

function labelFor(step) {
  const map = {
    created: "Waiting for IDE input",
    submitted: "Queued",
    reading: "Reading inputs",
    analyzing: "Analyzing the job",
    tailoring: "Tailoring resume",
    scoring: "Scoring for ATS",
    revising: "Optimizing keywords",
    rendering: "Rendering PDF",
    done: "Done",
  };
  return map[step] || "Working";
}

function enterReview(status) {
  showView("review");
  window.scrollTo(0, 0);

  const pdfUrl = `/api/output/${encodeURIComponent(state.runId)}/resume.pdf`;
  $("downloadBtn").href = pdfUrl;
  $("downloadBtn").setAttribute("download", "tailored-resume.pdf");
  $("openBtn").href = pdfUrl;

  reloadPreview(status.previewVersion || Date.now());
  if (status.report) applyReport(status.report);
  startChatPolling();
}

function reloadPreview(version) {
  if (version === state.previewVersion) return;
  state.previewVersion = version;
  $("previewFrame").src = `/api/output/${encodeURIComponent(state.runId)}/resume.html?v=${version}`;
}

function applyReport(report) {
  const sig = JSON.stringify([report.atsScore, report.breakdown, report.matchedKeywords, report.missingKeywords]);
  if (sig === state.lastReportSig) return;
  state.lastReportSig = sig;

  const score = report.atsScore != null ? report.atsScore : 0;
  animateGauge(score);
  $("scoreVerdict").textContent = verdict(score);

  renderBreakdown(report.breakdown);
  renderChips("matchedChips", (report.matchedKeywords || []).slice(0, 28), "match");
  const missing = (report.missingKeywords || []).slice(0, 16);
  $("missingWrap").classList.toggle("hidden", missing.length === 0);
  if (missing.length) renderChips("missingChips", missing, "miss");
  renderList("changeWrap", "changeLog", report.changeLog);
  renderList("gapWrap", "gapList", report.recommendations || report.gapAnalysis);
}

function verdict(score) {
  if (score >= 90) return "Excellent match";
  if (score >= 80) return "Strong match";
  if (score >= 70) return "Good match";
  if (score >= 55) return "Needs work";
  return "Low match";
}

function animateGauge(score) {
  const arc = $("gaugeArc");
  const circumference = 2 * Math.PI * 52;
  const offset = circumference * (1 - Math.max(0, Math.min(100, score)) / 100);
  const color = score >= 90 ? "#34d399" : score >= 75 ? "#22d3ee" : score >= 60 ? "#fbbf24" : "#fb7185";
  arc.setAttribute("stroke", color);
  arc.style.transition = "stroke-dashoffset 1s ease";
  requestAnimationFrame(() => arc.setAttribute("stroke-dashoffset", offset.toFixed(1)));

  let n = state.scoreShown != null ? state.scoreShown : 0;
  state.scoreShown = score;
  const dir = score >= n ? 1 : -1;
  const timer = setInterval(() => {
    n += dir * Math.max(1, Math.round(Math.abs(score - n) / 6));
    if ((dir > 0 && n >= score) || (dir < 0 && n <= score)) n = score;
    $("scoreNum").textContent = n;
    if (n === score) clearInterval(timer);
  }, 28);
}

function renderBreakdown(breakdown) {
  const host = $("breakdown");
  host.innerHTML = "";
  if (!breakdown || !breakdown.points || !breakdown.maxPoints) return;

  const labels = {
    keywordCoverage: "Keyword coverage",
    hardSkills: "Hard skills",
    titleMatch: "Title match",
    sections: "Sections",
    contact: "Contact info",
    format: "Format and length",
  };

  for (const key of Object.keys(breakdown.maxPoints)) {
    const got = (breakdown.points && breakdown.points[key]) || 0;
    const max = breakdown.maxPoints[key];
    const pct = max ? Math.round((got / max) * 100) : 0;
    const row = document.createElement("div");
    row.innerHTML = `
      <div class="flex justify-between text-[11px] text-slate-400 mb-1">
        <span>${labels[key] || key}</span><span>${got.toFixed ? got.toFixed(1) : got}/${max}</span>
      </div>
      <div class="bar"><span style="width:${pct}%"></span></div>`;
    host.appendChild(row);
  }
}

function renderChips(hostId, items, kind) {
  const host = $(hostId);
  host.innerHTML = "";
  if (!items || !items.length) {
    host.innerHTML = `<span class="text-xs text-slate-500">None</span>`;
    return;
  }
  for (const item of items) {
    const span = document.createElement("span");
    span.className =
      "chip " +
      (kind === "miss"
        ? "bg-amber-500/10 text-amber-300 border border-amber-500/20"
        : "bg-emerald-500/10 text-emerald-300 border border-emerald-500/20");
    span.textContent = item;
    host.appendChild(span);
  }
}

function renderList(wrapId, listId, items) {
  const wrap = $(wrapId);
  const list = $(listId);
  if (!items || !items.length) {
    wrap.classList.add("hidden");
    return;
  }
  wrap.classList.remove("hidden");
  list.innerHTML = "";
  for (const item of items) {
    const li = document.createElement("li");
    li.textContent = typeof item === "string" ? item : item.text || JSON.stringify(item);
    list.appendChild(li);
  }
}

function startChatPolling() {
  clearInterval(state.chatPoll);
  state.chatPoll = setInterval(loadChat, 1400);
  loadChat();
}

async function loadChat() {
  if (!state.runId) return;
  try {
    const data = await fetchJson(`/api/chat/${encodeURIComponent(state.runId)}`);
    renderChat(data.messages || []);
    $("chatTyping").classList.add("hidden");
    if (typeof data.previewVersion === "number" && data.previewVersion > 0) reloadPreview(data.previewVersion);
    if (data.report) applyReport(data.report);
  } catch (_) {}
}

function renderChat(messages) {
  const log = $("chatLog");
  const sig = JSON.stringify(messages.map((m) => [m.role, m.kind, m.text]));
  if (sig === log.dataset.sig) return;
  log.dataset.sig = sig;
  log.innerHTML = "";

  if (!messages.length) {
    log.innerHTML = `<div class="text-xs text-slate-500 text-center mt-6">Agent notes and enhancement questions appear here. Reply in your IDE chat.</div>`;
    return;
  }

  for (const message of messages) {
    const row = document.createElement("div");
    row.className = "flex " + (message.role === "user" ? "justify-end" : "justify-start");
    const bubble = document.createElement("div");
    bubble.className =
      "bubble " +
      (message.role === "user" ? "me" : "ai") +
      (message.kind === "question" ? " q" : "");
    bubble.textContent = message.text;
    row.appendChild(bubble);
    log.appendChild(row);
  }
  log.scrollTop = log.scrollHeight;
}

$("startOverBtn").addEventListener("click", () => {
  clearInterval(state.poll);
  clearInterval(state.chatPoll);
  state.runId = null;
  state.previewVersion = -1;
  state.lastReportSig = "";
  state.scoreShown = null;
  try {
    localStorage.removeItem(LS_KEY);
  } catch (_) {}
  history.replaceState(null, "", location.pathname);
  showView("input");
});

$("chatForm").addEventListener("submit", (event) => {
  event.preventDefault();
});

(async function init() {
  const id = await resolveInitialRun();
  await loadRun(id);
})();
