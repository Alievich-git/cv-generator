# IDE-First CV Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the product flow so users type `start cv` in any agentic IDE, continue all AI interaction in that IDE, and use the local web app only as a live preview/report dashboard.

**Architecture:** The AI protocol lives in `AGENTS.md` and is IDE-agnostic. The Node server remains a local file/dashboard server with no AI dependency. A small run-store helper exposes the latest run so the dashboard can auto-load whatever the IDE agent is processing.

**Tech Stack:** Node.js, Express, vanilla browser JavaScript, Puppeteer, built-in `node:test`.

---

### Task 1: Latest Run Helper

**Files:**
- Create: `src/runStore.js`
- Test: `test/runStore.test.js`

- [ ] **Step 1: Write failing tests for latest run lookup**

Use temporary run folders with `status.json` files. Verify invalid folders are ignored and the latest `updatedAt`/`createdAt` run is selected.

- [ ] **Step 2: Implement `latestRunSummary(runsDir)`**

Return `{ runId, status }` for the newest run, or `null` when no valid run exists.

- [ ] **Step 3: Run tests**

Run `npm test`.

### Task 2: Preview Dashboard API

**Files:**
- Modify: `server.js`
- Test: `test/runStore.test.js`

- [ ] **Step 1: Add `/api/runs/latest`**

Use `latestRunSummary(RUNS)` so the browser can auto-load the current IDE-created run.

- [ ] **Step 2: Add port fallback**

If the desired port is occupied, try the next ports and print the actual URL.

### Task 3: IDE-First Browser UI

**Files:**
- Modify: `public/app.js`
- Modify: `public/index.html`

- [ ] **Step 1: Replace browser-submit assumptions**

Remove the browser as the primary input/chat surface. The page should auto-load `?run=<id>`, local storage, or `/api/runs/latest`.

- [ ] **Step 2: Keep preview/report live**

Poll status, refresh preview when `previewVersion` changes, render ATS score, keywords, change log, and recommendations.

- [ ] **Step 3: Make chat read-only**

Show assistant notes/questions from `thread.json`, but tell users to answer in the IDE.

### Task 4: Agent Protocol Docs

**Files:**
- Modify: `AGENTS.md`
- Modify: `README.md`

- [ ] **Step 1: Change trigger to `start cv`**

The boot flow starts the local dashboard, asks the user in the IDE for resume and job inputs, creates a run folder, and processes it.

- [ ] **Step 2: Remove worker-loop dependency from the primary flow**

The agent does not rely on browser chat or `src/watch.js` for normal use.

- [ ] **Step 3: Document the cross-IDE expectation**

Any agentic IDE can follow the file protocol and scripts without Cursor-specific APIs.
