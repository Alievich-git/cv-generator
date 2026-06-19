"use strict";

const $ = (id) => document.getElementById(id);

const state = {
  resumeFile: null,
  screenshots: [],
  runId: null,
  poll: null,
  chatPoll: null,
  previewVersion: -1,
  lastReportSig: "",
  scoreShown: null,
};

const LS_KEY = "cvgen.lastRun";

// ---------------------------------------------------------------- views
function showView(name) {
  $("inputView").classList.toggle("hidden", name !== "input");
  $("statusView").classList.toggle("hidden", name !== "status");
  $("reviewView").classList.toggle("hidden", name !== "review");
}

// ---------------------------------------------------------------- resume
const resumeDrop = $("resumeDrop");
const resumeInput = $("resumeInput");

resumeDrop.addEventListener("click", (e) => {
  if (e.target.id === "resumeRemove") return;
  resumeInput.click();
});
resumeInput.addEventListener("change", () => {
  if (resumeInput.files[0]) setResume(resumeInput.files[0]);
});
dndZone(resumeDrop, (files) => {
  if (files[0]) setResume(files[0]);
});

function setResume(file) {
  state.resumeFile = file;
  $("resumeName").textContent = `${file.name} · ${(file.size / 1024).toFixed(0)} KB`;
  $("resumeEmpty").classList.add("hidden");
  $("resumeChosen").classList.remove("hidden");
  validate();
}
$("resumeRemove").addEventListener("click", (e) => {
  e.stopPropagation();
  state.resumeFile = null;
  resumeInput.value = "";
  $("resumeEmpty").classList.remove("hidden");
  $("resumeChosen").classList.add("hidden");
  validate();
});

$("pasteToggle").addEventListener("click", () => {
  $("resumeText").classList.toggle("hidden");
  $("resumeText").focus();
});
$("resumeText").addEventListener("input", validate);

// ---------------------------------------------------------------- job tabs
document.querySelectorAll(".tabbtn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tabbtn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    const tab = btn.dataset.tab;
    $("tab-paste").classList.toggle("hidden", tab !== "paste");
    $("tab-shots").classList.toggle("hidden", tab !== "shots");
  });
});

["jobTitle", "companyName", "jobDescription", "requirements", "responsibilities", "aboutCompany"].forEach(
  (id) => $(id).addEventListener("input", validate)
);

// ---------------------------------------------------------------- screenshots
const shotDrop = $("shotDrop");
const shotInput = $("shotInput");
shotDrop.addEventListener("click", () => shotInput.click());
shotInput.addEventListener("change", () => addShots([...shotInput.files]));
dndZone(shotDrop, (files) => addShots(files.filter((f) => f.type.startsWith("image/"))));

function addShots(files) {
  for (const f of files) {
    if (state.screenshots.length >= 10) break;
    state.screenshots.push(f);
  }
  renderShots();
  validate();
}
function renderShots() {
  const grid = $("shotGrid");
  grid.innerHTML = "";
  state.screenshots.forEach((f, i) => {
    const url = URL.createObjectURL(f);
    const wrap = document.createElement("div");
    wrap.className = "relative group";
    wrap.innerHTML = `
      <img src="${url}" class="h-20 w-full object-cover rounded-lg border border-line" />
      <button data-i="${i}" class="absolute -top-1.5 -right-1.5 h-5 w-5 rounded-full bg-rose-500 text-white text-xs leading-none">×</button>`;
    wrap.querySelector("button").addEventListener("click", () => {
      state.screenshots.splice(i, 1);
      renderShots();
      validate();
    });
    grid.appendChild(wrap);
  });
}

// ---------------------------------------------------------------- helpers
function dndZone(el, onFiles) {
  ["dragenter", "dragover"].forEach((ev) =>
    el.addEventListener(ev, (e) => {
      e.preventDefault();
      el.classList.add("drag");
    })
  );
  ["dragleave", "drop"].forEach((ev) =>
    el.addEventListener(ev, (e) => {
      e.preventDefault();
      el.classList.remove("drag");
    })
  );
  el.addEventListener("drop", (e) => onFiles([...e.dataTransfer.files]));
}

function hasJobInfo() {
  const txt = ["jobTitle", "companyName", "jobDescription", "requirements", "responsibilities", "aboutCompany"]
    .map((id) => $(id).value.trim())
    .join("");
  return txt.length > 0 || state.screenshots.length > 0;
}
function hasResume() {
  return !!state.resumeFile || $("resumeText").value.trim().length > 30;
}

function validate() {
  const ok = hasResume() && hasJobInfo();
  $("runBtn").disabled = !ok;
  $("hint").textContent = ok
    ? "Ready. Press Run — I'll tailor it, then we refine it together right here."
    : !hasResume()
    ? "Add your current resume (file or pasted text)."
    : "Add the job details (paste text or screenshots).";
  return ok;
}

// ---------------------------------------------------------------- run
$("runBtn").addEventListener("click", run);

async function run() {
  if (!validate()) return;
  $("runBtn").disabled = true;
  $("runBtn").textContent = "Submitting…";

  const fd = new FormData();
  if (state.resumeFile) fd.append("resume", state.resumeFile);
  fd.append("resumeText", $("resumeText").value);
  state.screenshots.forEach((f) => fd.append("screenshots", f));
  fd.append("jobTitle", $("jobTitle").value);
  fd.append("companyName", $("companyName").value);
  fd.append("jobDescription", $("jobDescription").value);
  fd.append("requirements", $("requirements").value);
  fd.append("responsibilities", $("responsibilities").value);
  fd.append("aboutCompany", $("aboutCompany").value);
  fd.append("accentColor", $("accent").value);
  fd.append("pageSize", $("pageSize").value);

  try {
    const r = await fetch("/api/run", { method: "POST", body: fd });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || "submit failed");
    state.runId = data.runId;
    try {
      localStorage.setItem(LS_KEY, data.runId);
    } catch (_) {}
    showView("status");
    $("runBtn").textContent = "Run — tailor my resume";
    startPolling();
  } catch (e) {
    $("runBtn").disabled = false;
    $("runBtn").textContent = "Run — tailor my resume";
    alert("Could not submit: " + e.message);
  }
}

$("startOverBtn").addEventListener("click", () => {
  clearInterval(state.chatPoll);
  clearInterval(state.poll);
  state.runId = null;
  state.previewVersion = -1;
  state.lastReportSig = "";
  state.scoreShown = null;
  try {
    localStorage.removeItem(LS_KEY);
  } catch (_) {}
  history.replaceState(null, "", location.pathname);
  showView("input");
  validate();
});

const STEP_PROGRESS = {
  submitted: 6,
  reading: 22,
  analyzing: 40,
  tailoring: 58,
  scoring: 74,
  revising: 80,
  rendering: 90,
  done: 100,
};

function startPolling() {
  clearInterval(state.poll);
  state.poll = setInterval(tick, 1500);
  tick();
}

async function tick() {
  if (!state.runId) return;
  let s;
  try {
    const r = await fetch(`/api/status/${state.runId}`);
    s = await r.json();
  } catch (_) {
    return;
  }
  const prog = typeof s.progress === "number" ? s.progress : STEP_PROGRESS[s.state] || 10;
  $("progressBar").style.width = Math.max(4, Math.min(100, prog)) + "%";
  $("stepLabel").textContent = labelFor(s.step || s.state);
  $("statusMsg").textContent = s.message || "";

  if (s.state === "done") {
    clearInterval(state.poll);
    enterReview(s);
  } else if (s.state === "error") {
    clearInterval(state.poll);
    $("statusSpin").classList.add("hidden");
    $("stepLabel").textContent = "Something went wrong";
    $("stepLabel").classList.add("text-rose-300");
    $("statusMsg").textContent = s.message || "The agent reported an error.";
  }
}

function labelFor(step) {
  const map = {
    submitted: "Queued",
    reading: "Reading your inputs",
    analyzing: "Analyzing the job",
    tailoring: "Tailoring your resume",
    scoring: "Scoring for ATS",
    revising: "Optimizing keywords",
    rendering: "Rendering PDF",
    done: "Done",
  };
  return map[step] || "Working…";
}

// ---------------------------------------------------------------- review
function enterReview(s) {
  showView("review");
  window.scrollTo(0, 0);
  const pdfUrl = `/api/output/${state.runId}/resume.pdf`;
  $("downloadBtn").href = pdfUrl;
  $("downloadBtn").setAttribute("download", "tailored-resume.pdf");
  $("openBtn").href = pdfUrl;

  reloadPreview(s.previewVersion || Date.now());
  if (s.report) applyReport(s.report);

  startChatPolling();
}

function reloadPreview(version) {
  if (version === state.previewVersion) return;
  state.previewVersion = version;
  $("previewFrame").src = `/api/output/${state.runId}/resume.html?v=${version}`;
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
  if (missing.length) {
    $("missingWrap").classList.remove("hidden");
    renderChips("missingChips", missing, "miss");
  } else {
    $("missingWrap").classList.add("hidden");
  }
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
  const C = 2 * Math.PI * 52; // ~327
  const offset = C * (1 - Math.max(0, Math.min(100, score)) / 100);
  const color = score >= 90 ? "#34d399" : score >= 75 ? "#22d3ee" : score >= 60 ? "#fbbf24" : "#fb7185";
  arc.setAttribute("stroke", color);
  arc.style.transition = "stroke-dashoffset 1s ease";
  requestAnimationFrame(() => arc.setAttribute("stroke-dashoffset", offset.toFixed(1)));
  let n = state.scoreShown != null ? state.scoreShown : 0;
  state.scoreShown = score;
  const dir = score >= n ? 1 : -1;
  const t = setInterval(() => {
    n += dir * Math.max(1, Math.round(Math.abs(score - n) / 6));
    if ((dir > 0 && n >= score) || (dir < 0 && n <= score)) n = score;
    $("scoreNum").textContent = n;
    if (n === score) clearInterval(t);
  }, 28);
}

function renderBreakdown(b) {
  const host = $("breakdown");
  host.innerHTML = "";
  if (!b || !b.points || !b.maxPoints) return;
  const labels = {
    keywordCoverage: "Keyword coverage",
    hardSkills: "Hard skills",
    titleMatch: "Title match",
    sections: "Sections",
    contact: "Contact info",
    format: "Format & length",
  };
  for (const key of Object.keys(b.maxPoints)) {
    const got = (b.points && b.points[key]) || 0;
    const max = b.maxPoints[key];
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
    host.innerHTML = `<span class="text-xs text-slate-500">—</span>`;
    return;
  }
  for (const it of items) {
    const span = document.createElement("span");
    span.className =
      "chip " +
      (kind === "miss"
        ? "bg-amber-500/10 text-amber-300 border border-amber-500/20"
        : "bg-emerald-500/10 text-emerald-300 border border-emerald-500/20");
    span.textContent = it;
    host.appendChild(span);
  }
}

function renderList(wrapId, listId, items) {
  if (!items || !items.length) {
    $(wrapId).classList.add("hidden");
    return;
  }
  $(wrapId).classList.remove("hidden");
  const ul = $(listId);
  ul.innerHTML = "";
  for (const it of items) {
    const li = document.createElement("li");
    li.textContent = typeof it === "string" ? it : it.text || JSON.stringify(it);
    ul.appendChild(li);
  }
}

// ---------------------------------------------------------------- chat
function startChatPolling() {
  clearInterval(state.chatPoll);
  state.chatPoll = setInterval(loadChat, 1400);
  loadChat();
}

async function loadChat() {
  if (!state.runId) return;
  let data;
  try {
    const r = await fetch(`/api/chat/${state.runId}`);
    data = await r.json();
  } catch (_) {
    return;
  }
  renderChat(data.messages || [], data.pending || []);
  $("chatTyping").classList.toggle("hidden", !data.thinking);
  if (data.thinking) scrollChat();
  if (typeof data.previewVersion === "number" && data.previewVersion > 0) {
    reloadPreview(data.previewVersion);
  }
  if (data.report) applyReport(data.report);
}

function renderChat(messages, pending) {
  const log = $("chatLog");
  const all = [...messages, ...pending];
  const sig = JSON.stringify(all.map((m) => [m.role, m.text, m.pending || false]));
  if (sig === log.dataset.sig) return; // nothing changed; don't fight scroll
  const nearBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 80;
  log.dataset.sig = sig;
  log.innerHTML = "";

  if (!all.length) {
    log.innerHTML = `<div class="text-xs text-slate-500 text-center mt-6">The assistant will say hello in a moment…</div>`;
    return;
  }

  for (const m of all) {
    const row = document.createElement("div");
    row.className = "flex " + (m.role === "user" ? "justify-end" : "justify-start");
    const b = document.createElement("div");
    b.className =
      "bubble " +
      (m.role === "user" ? "me" : "ai") +
      (m.kind === "question" ? " q" : "") +
      (m.pending ? " opacity-60" : "");
    b.textContent = m.text;
    row.appendChild(b);
    log.appendChild(row);
  }
  if (nearBottom) scrollChat();
}

function scrollChat() {
  const log = $("chatLog");
  log.scrollTop = log.scrollHeight;
}

const chatInput = $("chatInput");
chatInput.addEventListener("input", () => {
  chatInput.style.height = "auto";
  chatInput.style.height = Math.min(128, chatInput.scrollHeight) + "px";
});
chatInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    $("chatForm").requestSubmit();
  }
});

$("chatForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = chatInput.value.trim();
  if (!text || !state.runId) return;
  chatInput.value = "";
  chatInput.style.height = "auto";
  $("chatSend").disabled = true;
  try {
    await fetch(`/api/chat/${state.runId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
  } catch (_) {}
  $("chatSend").disabled = false;
  loadChat();
});

// ---------------------------------------------------------------- resume on load
async function tryResume(id) {
  try {
    const r = await fetch(`/api/status/${id}`);
    if (!r.ok) return false;
    const s = await r.json();
    state.runId = id;
    if (s.state === "done") {
      enterReview(s);
      return true;
    }
    if (s.state && s.state !== "error") {
      showView("status");
      startPolling();
      return true;
    }
  } catch (_) {}
  return false;
}

(async function init() {
  validate();
  const params = new URLSearchParams(location.search);
  const id = params.get("run") || (() => { try { return localStorage.getItem(LS_KEY); } catch (_) { return null; } })();
  if (id) {
    const ok = await tryResume(id);
    if (!ok) {
      try { localStorage.removeItem(LS_KEY); } catch (_) {}
    }
  }
})();
