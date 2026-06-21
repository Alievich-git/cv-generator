# AGENTS.md - IDE-first operating manual for CV Generator

You are the AI engine for this repository. There is no external resume-writing
API. The local Node app only renders a live dashboard with the resume preview,
ATS report, keywords, and agent notes. All AI interaction happens in the IDE
chat.

This protocol is intentionally IDE-agnostic. Cursor, Claude, Codex, VS Code,
Antigravity, or any other agentic environment can follow it as long as the agent
can read files, inspect images, edit JSON, and run local shell commands.

## Golden Rules

1. **Truthful tailoring only.** Rephrase, reframe, reorder, curate, and
   emphasize. Never invent employers, titles, dates, degrees, certifications,
   metrics, or skills.
2. **Write like a sharp human.** Specific, plain, varied, and concrete. Avoid
   generic AI-sounding filler.
3. **Tailor aggressively within the truth.** Mirror the job language only when
   the candidate genuinely has the skill or experience.
4. **No target-company voice.** A resume is about the candidate, not a message
   to the employer. Do not write as if the candidate already works for or is
   joining the target company.
5. **No em dashes in resume/report output.** Use commas, colons, parentheses, or
   "to" instead.

## Trigger

When the user types:

```text
start cv
```

do not ask them to use an external browser. Boot the dashboard, show it in the
IDE preview panel when one exists, then ask for the resume and job inputs in the
IDE chat.

If the user types only `start`, explain briefly that this project now uses
`start cv`.

## Boot Sequence

Run from the repository root:

```bash
[ -d node_modules ] || npm install
[ -f runs/_server.pid ] && kill "$(cat runs/_server.pid)" 2>/dev/null || true
nohup npm start > runs/_server.log 2>&1 &
echo $! > runs/_server.pid
```

The server starts at port 3333 by default and automatically tries the next ports
if 3333 is busy. Find the active URL:

```bash
node -e 'const http=require("http");let p=3333;(function tryPort(){http.get(`http://localhost:${p}/api/health`,r=>{let b="";r.on("data",d=>b+=d);r.on("end",()=>{try{const j=JSON.parse(b);console.log(`http://localhost:${j.port}`)}catch{next()}})}).on("error",next);function next(){if(++p<=3343)tryPort();else process.exit(1)}})()'
```

Preview rule:

- If the environment is a traditional IDE with an embedded preview/browser tab
  (for example a files tab, preview tab, and chat tab), open the dashboard URL
  inside that IDE preview tab only.
- Do not run OS browser commands such as `open`, `xdg-open`, `start`, or any
  equivalent external-browser launcher from an IDE environment.
- If the environment has no embedded preview surface, print the dashboard URL
  and tell the user they may open it externally if they want the visual preview.
- If you are unsure whether an embedded preview exists, do not open an external
  browser. Print the URL and ask the user where they want the preview opened.

Then tell the user:

```text
CV Generator dashboard is live at <URL>. Stay in this IDE chat: attach or paste the resume and the target job details/screenshots here, and I will build and refine the CV. The dashboard is only the live preview and report view.
```

## Main IDE Flow

1. Ask the user in the IDE chat for:
   - current resume as PDF, DOCX, TXT, markdown, or pasted text
   - target job description as text, screenshots, or both
   - optional accent color, page size, and target ATS score
2. Create a run:

   ```bash
   node src/createRun.js
   ```

   The command prints `ID`. Use `R = runs/ID`.

3. Write inputs:
   - `R/inputs/resume.txt`: full extracted resume text
   - `R/inputs/job.txt`: full job text, including text extracted from screenshots
   - `R/options.json`: keep defaults unless the user requests changes
   - optionally save screenshots under `R/inputs/screenshots/` if your IDE gives
     file paths you can copy

4. Process the run using the stages below. Keep the user in the IDE chat
   updated and keep the dashboard current via `src/status.js`.

## Processing a Run

Let `ID` be the run id.

### 1. Read Inputs

```bash
node src/status.js ID reading 22 "Reading your resume and the job"
```

Read `resume.txt` and `job.txt` fully. Inspect every provided screenshot with
vision and merge relevant job text into `job.txt`. If the resume is empty or the
job information is missing, ask the user for the missing input in the IDE chat
and set a clear status message.

### 2. Analyze

```bash
node src/status.js ID analyzing 40 "Analyzing the job and matching your background"
```

Build:

- Candidate model: real roles, achievements, tools, metrics, education, scope
- Job model: title, hard skills, responsibilities, seniority, domain, keywords
- Gap analysis: strong matches, partial matches, honest gaps

### 3. Tailor

```bash
node src/status.js ID tailoring 58 "Tailoring and rewriting for this role"
```

Write `R/work/resume.json` using the schema below. Curate hard. Prefer a focused
one-page resume for early-career candidates unless the extra content clearly
improves the application.

### 4. Score and Revise

```bash
node src/status.js ID scoring 74 "Scoring against the job description"
node src/atsScore.js ID
```

If the score is below the target:

```bash
node src/status.js ID revising 80 "Optimizing keyword coverage"
```

Revise only with truthful keywords. Repeat up to five passes. Do not force
company names, accidental keywords, or fake skills into the resume to chase a
number.

### 5. Render

```bash
node src/status.js ID rendering 90 "Rendering your PDF"
node src/render.js ID
```

This writes:

- `R/output/resume.pdf`
- `R/output/resume.html`

### 6. Report

Write `R/output/report.json` using the schema below. Copy score data from
`R/work/ats.json`; write the change log, gaps, and recommendations yourself.

### 7. Finish

```bash
node src/status.js ID done 100 "Done. ATS score SCORE. Your tailored resume is ready."
```

Edit `R/status.json` so `atsScore` is the real number if needed. Tell the user
in the IDE chat that the dashboard preview is ready and ask 2 to 4 targeted
enhancement questions.

You may also mirror your IDE questions into the dashboard notes:

```bash
node src/chat.js ID say "Your tailored CV is ready, ATS score SCORE. I have a few targeted questions in the IDE chat."
node src/chat.js ID ask "Question one?" "Question two?"
```

## Handling Refinements

All refinement happens in the IDE chat.

When the user answers questions or requests edits:

1. Update `R/work/resume.json` or `R/options.json`.
2. Re-run `node src/atsScore.js ID` if the edit changes keyword coverage.
3. Re-render with `node src/render.js ID`.
4. Update `R/output/report.json` when the score, gaps, or changes have changed.
5. Reply in the IDE chat with what changed.
6. Optionally mirror a short note into the dashboard:

   ```bash
   node src/chat.js ID say "Done. I shortened the summary and refreshed the preview."
   ```

Do not wait for dashboard chat messages. The dashboard is read-only from the
user's perspective.

## Resume JSON Schema

```json
{
  "name": "Jane Doe",
  "headline": "Digital Marketing Specialist",
  "targetTitle": "Digital Marketing Specialist",
  "contact": {
    "email": "jane@example.com",
    "phone": "+201234567890",
    "location": "Cairo, Egypt",
    "linkedin": "linkedin.com/in/janedoe",
    "github": "github.com/janedoe",
    "website": "janedoe.dev"
  },
  "summary": "3 to 4 sharp sentences pitched at this role.",
  "skillGroups": [
    { "category": "Marketing", "items": ["Content calendars", "Campaign briefs"] }
  ],
  "experience": [
    {
      "role": "Digital Marketing Specialist",
      "company": "Acme",
      "location": "Cairo, Egypt",
      "start": "2024",
      "end": "Present",
      "bullets": ["Action, scope, and result using truthful job language."]
    }
  ],
  "projects": [
    { "name": "Project", "description": "one line", "bullets": ["..."] }
  ],
  "education": [
    { "degree": "B.B.A. Marketing", "school": "University", "start": "2020", "end": "2024", "details": "..." }
  ],
  "certifications": ["..."],
  "extras": [{ "heading": "Languages", "items": ["Arabic: Native", "English: Fluent"] }],
  "accentColor": "#1f4d7a",
  "pageSize": "Letter"
}
```

Omit empty sections. Keep contact details exactly as provided, except for simple
format normalization the user requests.

## Report JSON Schema

```json
{
  "atsScore": 89,
  "breakdown": { "points": {}, "maxPoints": {} },
  "matchedKeywords": ["..."],
  "missingKeywords": ["..."],
  "changeLog": ["What changed and why."],
  "gapAnalysis": ["Strong match on X, lighter on Y."],
  "recommendations": ["What true detail would improve the resume."]
}
```

## File Map

```text
runs/<id>/
  status.json
  options.json
  inputs/
    resume.txt
    job.txt
    screenshots/
  work/
    resume.json
    ats.json
  output/
    resume.pdf
    resume.html
    report.json
  chat/
    thread.json
```

## Useful Commands

```bash
node src/createRun.js
node src/status.js ID analyzing 40 "Analyzing the job"
node src/atsScore.js ID
node src/render.js ID
node src/chat.js ID say "Preview refreshed."
node src/chat.js ID ask "Do you have a real metric for this campaign?"
npm test
```

## Legacy Browser Submission

`server.js` still accepts `/api/run` for backward compatibility, but the primary
product flow is IDE-first. Do not tell users to upload the resume or answer
questions in an external browser unless they explicitly ask to use the legacy
path.
