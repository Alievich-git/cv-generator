# CV Generator

Tailor a resume to a specific job, optimize it for ATS, and render a clean PDF
using the AI agent inside your IDE. No OpenAI key, Cursor API key, or vendor
specific agent API is required.

The app is now **IDE-first**:

1. Open the repo in any agentic IDE or coding environment.
2. Type `start cv` in the IDE chat.
3. Attach or paste the candidate resume and target job details in that same IDE
   chat.
4. The agent creates a run, tailors the resume, scores it, renders the PDF, and
   asks follow-up questions in the IDE.
5. The browser dashboard is only a live viewer for the PDF/HTML preview, ATS
   score, matched/missing keywords, change log, and recommendations.

This avoids the fragile browser-chat loop where a web page waits for an IDE
agent that may have timed out.

## Requirements

- Node.js 18+
- An agentic IDE or environment that can follow `AGENTS.md`, read files/images,
  edit JSON, and run shell commands

Examples: Cursor, Claude, Codex, VS Code with an agent, Antigravity, or similar.

## Quick Start

```bash
git clone <this-repo>
cd "CV Generator"
# open this folder in your agentic IDE
```

In the IDE chat, type:

```text
start cv
```

The agent will install dependencies if needed, start the local dashboard, and
ask for the resume and target job information in the IDE chat.

## What the Browser Does

The browser dashboard shows:

- live resume preview
- PDF download link
- ATS score and breakdown
- matched and missing keywords
- what changed
- recommendations and gaps
- read-only agent notes

The browser is **not** the AI chat. Answer questions and request edits in the
IDE chat.

## What the Agent Does

The agent follows `AGENTS.md`:

1. Creates a run with `node src/createRun.js`.
2. Writes `runs/<id>/inputs/resume.txt` and `runs/<id>/inputs/job.txt`.
3. Writes `runs/<id>/work/resume.json`.
4. Scores with `node src/atsScore.js <id>`.
5. Renders with `node src/render.js <id>`.
6. Writes `runs/<id>/output/report.json`.
7. Asks improvement questions in the IDE chat and applies live edits.

## Project Layout

```text
AGENTS.md
server.js
src/
  createRun.js
  runStore.js
  extract.js
  atsScore.js
  render.js
  status.js
  chat.js
  watch.js
template/
  resume.html
  resume.css
public/
  index.html
  app.js
runs/
  <id>/
    inputs/
    work/
    output/
    chat/
test/
  runStore.test.js
```

`src/watch.js` and the browser `/api/run` endpoint remain for backward
compatibility, but they are no longer the primary workflow.

## Commands

```bash
npm install
npm start
npm test
node src/createRun.js
node src/status.js <id> analyzing 40 "Analyzing the job"
node src/atsScore.js <id>
node src/render.js <id>
```

## Dashboard Port

The server tries `3333` first and automatically falls back to the next available
ports if needed. The active URL is printed when `npm start` runs.

## Truthfulness Rules

The generator may rephrase, reorder, and emphasize real experience. It must not
invent employers, job titles, dates, degrees, certifications, metrics, or skills.
Gaps should be explained in the report, not hidden with fake claims.

No tool can guarantee a job offer. This project improves the parts under your
control: ATS fit, relevance, clarity, formatting, and presentation.
