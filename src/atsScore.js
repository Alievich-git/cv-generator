"use strict";

/**
 * Transparent, Jobscan-style ATS scorer.
 *
 * It does NOT pretend to be any specific vendor's parser. It mirrors the
 * checks that real applicant-tracking systems and tools like Jobscan use:
 *   - keyword / hard-skill coverage vs the job description
 *   - target job-title match
 *   - presence of the standard resume sections
 *   - parseable contact info (email + phone)
 *   - format + length sanity (our template guarantees single-column,
 *     standard fonts and selectable text, so those are awarded by design)
 *
 * Output is a 0-100 score plus a breakdown and a prioritized list of the
 * keywords that are still missing, which the agent uses to revise the resume.
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");

const STOPWORDS = new Set(
  (
    "a an and are as at be by for from has have in is it its of on or that the to " +
    "with we you your our their they them this these those will would can could should " +
    "about above after again against all am any because been before being below between both " +
    "but did do does doing down during each few further here how into more most no nor not " +
    "now off once only other out over own same so some such than then there through too under " +
    "until up very was were what when where which while who whom why a's etc e.g i.e via per " +
    "across also among may might must shall within without upon onto including include includes " +
    "role job position candidate work working experience years year team teams ability able " +
    "strong excellent good great plus preferred required requirement requirements responsibility " +
    "responsibilities looking seeking join help build using use used new across multiple etc " +
    "company companies platform end well really matter run runs " +
    // generic job-description filler / business fluff that is not a real skill
    "facilitate facilitates facilitating successful success oversee overseeing own take " +
    "value values grow growth talents talent development understanding associate level " +
    "advisory expected apply applies drive drives quality reliable contributing environment " +
    "opportunity opportunities navigate firm unlock perspective perspectives unique difference " +
    "ready want leverage effectively various varying challenges scope adapt variety consistently " +
    "range sources habits sustain potential feelings others diverse appreciate commit refer " +
    "specific uphold conduct independence professional standards posted days ago reflect seek " +
    "express ideas check questions ask clearly skills knowledge experiences examples included limited"
  ).split(/\s+/)
);

// Curated multi-domain hard-skill dictionary. Hard skills are weighted more
// heavily because ATS keyword matching cares most about concrete competencies.
const SKILL_DICTIONARY = [
  // languages
  "javascript", "typescript", "python", "java", "c++", "c#", "c", "go", "golang", "rust",
  "ruby", "php", "swift", "kotlin", "scala", "r", "matlab", "perl", "bash", "shell",
  "sql", "nosql", "html", "css", "sass", "dart", "objective-c", "solidity", "elixir",
  // frameworks / libs
  "react", "react native", "next.js", "vue", "vue.js", "angular", "svelte", "node.js", "nodejs",
  "django", "flask", "fastapi", "spring", "spring boot", ".net", "asp.net", "rails",
  "laravel", "tailwind", "bootstrap", "redux", "graphql", "rest", "rest api", "grpc",
  "tensorflow", "pytorch", "keras", "scikit-learn", "pandas", "numpy", "spark", "hadoop",
  "jquery", "webpack", "vite", "nestjs", "remix", "astro",
  // cloud / devops
  "aws", "azure", "gcp", "google cloud", "docker", "kubernetes", "k8s", "terraform", "ansible",
  "jenkins", "ci/cd", "github actions", "gitlab", "circleci", "helm", "prometheus", "grafana",
  "linux", "nginx", "kafka", "rabbitmq", "redis", "elasticsearch", "serverless", "lambda",
  "cloudformation", "datadog", "splunk",
  // data / db
  "postgresql", "postgres", "mysql", "mongodb", "dynamodb", "cassandra", "snowflake", "bigquery",
  "redshift", "databricks", "etl", "data warehouse", "data pipeline", "airflow", "dbt", "tableau",
  "power bi", "looker", "data analysis", "data science", "machine learning", "deep learning",
  "nlp", "computer vision", "statistics", "a/b testing", "experimentation",
  // practices / methods
  "agile", "scrum", "kanban", "tdd", "microservices", "object-oriented", "oop", "functional programming",
  "system design", "distributed systems", "api design", "unit testing", "integration testing",
  "design patterns", "mvc", "devops", "sre", "observability", "monitoring", "security",
  "oauth", "jwt", "authentication", "authorization", "encryption",
  // product / pm / business
  "product management", "roadmap", "stakeholder management", "project management", "jira",
  "confluence", "okrs", "kpis", "go-to-market", "user research", "wireframing", "prototyping",
  "figma", "sketch", "adobe xd", "ux", "ui", "ui/ux", "user experience", "accessibility",
  // marketing / sales / ops
  "seo", "sem", "google analytics", "ga4", "content marketing", "email marketing", "hubspot",
  "salesforce", "crm", "marketing automation", "copywriting", "social media", "ppc",
  "lead generation", "account management", "negotiation", "forecasting", "budgeting",
  // finance / data analyst
  "excel", "vba", "financial modeling", "valuation", "accounting", "quickbooks", "sap",
  // soft / leadership (lighter weight but still matched)
  "leadership", "mentoring", "communication", "collaboration", "problem-solving",
  "cross-functional", "stakeholder", "presentation",
];

function lc(s) {
  return (s || "").toLowerCase();
}

/**
 * Whole-word / phrase containment that tolerates +, #, ., / inside tokens and
 * an optional trailing "s" so that, e.g., "REST APIs" satisfies "rest api" and
 * "pipelines" satisfies "pipeline".
 */
function containsTerm(haystackLc, term) {
  const t = lc(term).trim();
  if (!t) return false;
  const escaped = t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(^|[^a-z0-9+#.])${escaped}s?([^a-z0-9+#]|$)`, "i");
  return re.test(haystackLc);
}

function words(text) {
  return lc(text)
    .replace(/[^a-z0-9+#./\s-]/g, " ")
    .split(/\s+/)
    .map((w) => w.replace(/^[^a-z0-9]+/, "").replace(/[^a-z0-9+#]+$/, ""))
    .filter(Boolean);
}

function isMeaningful(w) {
  if (w.length < 3) return false;
  if (STOPWORDS.has(w)) return false;
  if (/^\d+$/.test(w)) return false;
  return true;
}

/**
 * Build a weighted keyword list from the job text.
 * Hard skills (from the dictionary) get weight 3, frequent single words and
 * meaningful bigrams get weight 1-2 depending on frequency.
 */
function extractJobKeywords(jobText) {
  const hay = lc(jobText);
  const keywords = new Map(); // term -> {weight, hard}

  // Skills that appear only under an "optional / preferred / nice-to-have"
  // section are nice-to-haves, not requirements, so they count for less than
  // skills emphasized in the description or requirements.
  const optMatch = hay.search(
    /optional skills|nice[\s-]?to[\s-]?have|preferred (skills|qualifications|experience)|good to have|bonus|a plus/
  );
  const mainText = optMatch >= 0 ? hay.slice(0, optMatch) : hay;

  // Org / program / brand proper nouns (e.g. "PwC", "ETIC", "LinkedIn") are not
  // skills, and we never want the candidate to name-drop the employer to score.
  // Detect them from the raw (cased) text: all-caps acronyms and brand-cased
  // tokens. Real all-caps skills (API, SQL, AWS) still score via the dictionary.
  const properNouns = new Set();
  for (const t of jobText.match(/[A-Za-z][A-Za-z.+#&'-]*/g) || []) {
    if (/^[A-Z]{2,6}$/.test(t) || /[a-z][A-Z]/.test(t)) properNouns.add(t.toLowerCase());
  }

  // 1) hard skills present in the job description
  for (const skill of SKILL_DICTIONARY) {
    if (!containsTerm(hay, skill)) continue;
    const inMain = containsTerm(mainText, skill);
    keywords.set(skill, inMain ? { weight: 3, hard: true } : { weight: 2, hard: false });
  }

  // 2) frequent meaningful single words
  const toks = words(jobText).filter(isMeaningful);
  const freq = new Map();
  for (const w of toks) freq.set(w, (freq.get(w) || 0) + 1);

  // 3) meaningful bigrams ("project management", "machine learning")
  const bigrams = new Map();
  for (let i = 0; i < toks.length - 1; i++) {
    const a = toks[i];
    const b = toks[i + 1];
    const bg = `${a} ${b}`;
    bigrams.set(bg, (bigrams.get(bg) || 0) + 1);
  }

  for (const [bg, c] of bigrams) {
    if (c < 2 || keywords.has(bg)) continue;
    const [a, b] = bg.split(" ");
    if (properNouns.has(a) || properNouns.has(b)) continue;
    keywords.set(bg, { weight: 2, hard: false });
  }
  for (const [w, c] of freq) {
    if (keywords.has(w) || properNouns.has(w)) continue;
    if (c >= 2) keywords.set(w, { weight: c >= 4 ? 2 : 1, hard: false });
  }

  // keep the list focused: cap soft keywords, always keep hard skills
  const entries = [...keywords.entries()];
  const hard = entries.filter(([, v]) => v.hard);
  const soft = entries
    .filter(([, v]) => !v.hard)
    .sort((a, b) => b[1].weight - a[1].weight)
    .slice(0, 35);

  return [...hard, ...soft].map(([term, v]) => ({ term, weight: v.weight, hard: v.hard }));
}

const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i;
const PHONE_RE = /(\+?\d[\d\s().-]{7,}\d)/;

/**
 * Score a tailored resume against a job description.
 * @param {{resumeText:string, jobText:string, jobTitle?:string, resumeJson?:object}} args
 */
function scoreResume({ resumeText, jobText, jobTitle, resumeJson }) {
  const resumeLc = lc(resumeText);
  const jobKeywords = extractJobKeywords(jobText);

  const matched = [];
  const missing = [];
  let totalWeight = 0;
  let matchedWeight = 0;
  let hardTotal = 0;
  let hardMatched = 0;

  for (const k of jobKeywords) {
    totalWeight += k.weight;
    if (k.hard) hardTotal += k.weight;
    const hit = containsTerm(resumeLc, k.term);
    if (hit) {
      matchedWeight += k.weight;
      if (k.hard) hardMatched += k.weight;
      matched.push(k.term);
    } else {
      missing.push({ term: k.term, hard: k.hard, weight: k.weight });
    }
  }

  // prioritize missing hard skills first, then by weight
  missing.sort((a, b) => Number(b.hard) - Number(a.hard) || b.weight - a.weight);

  const keywordCoverage = totalWeight ? matchedWeight / totalWeight : 1;
  const hardCoverage = hardTotal ? hardMatched / hardTotal : 1;

  // title match
  const title = lc(jobTitle || (resumeJson && resumeJson.targetTitle) || "");
  let titleMatch = 0;
  if (title) {
    if (containsTerm(resumeLc, title)) titleMatch = 1;
    else {
      const titleToks = words(title).filter(isMeaningful);
      const present = titleToks.filter((t) => containsTerm(resumeLc, t)).length;
      titleMatch = titleToks.length ? present / titleToks.length : 0;
    }
  } else {
    titleMatch = 1;
  }

  // sections
  const sec = detectSections(resumeJson, resumeText);
  const sectionScore =
    (sec.summary ? 0.25 : 0) +
    (sec.experience ? 0.35 : 0) +
    (sec.skills ? 0.25 : 0) +
    (sec.education ? 0.15 : 0);

  // contact
  const contactText = resumeJson && resumeJson.contact
    ? Object.values(resumeJson.contact).join(" ") + " " + resumeText
    : resumeText;
  const hasEmail = EMAIL_RE.test(contactText);
  const hasPhone = PHONE_RE.test(contactText);
  const contactScore = (hasEmail ? 0.6 : 0) + (hasPhone ? 0.4 : 0);

  // format + length (single column / fonts / selectable text guaranteed by template)
  const wc = words(resumeText).length;
  const estimatedPages = Math.max(1, Math.ceil(wc / 550));
  let lengthScore = 1;
  if (wc < 200) lengthScore = 0.5;
  else if (wc > 1200) lengthScore = 0.6;
  else if (estimatedPages > 2) lengthScore = 0.7;
  const formatScore = 0.7 /* template compliance */ + 0.3 * lengthScore;

  const weights = {
    keywordCoverage: 45,
    hardSkills: 20,
    titleMatch: 10,
    sections: 10,
    contact: 5,
    format: 10,
  };

  const parts = {
    keywordCoverage: keywordCoverage * weights.keywordCoverage,
    hardSkills: hardCoverage * weights.hardSkills,
    titleMatch: titleMatch * weights.titleMatch,
    sections: sectionScore * weights.sections,
    contact: contactScore * weights.contact,
    format: formatScore * weights.format,
  };

  const score = Math.round(
    Math.min(100, Object.values(parts).reduce((a, b) => a + b, 0))
  );

  return {
    score,
    breakdown: {
      keywordCoverage: round2(keywordCoverage),
      hardSkillCoverage: round2(hardCoverage),
      titleMatch: round2(titleMatch),
      sections: round2(sectionScore),
      contact: round2(contactScore),
      format: round2(formatScore),
      points: Object.fromEntries(
        Object.entries(parts).map(([k, v]) => [k, Math.round(v * 10) / 10])
      ),
      maxPoints: weights,
    },
    matchedKeywords: matched,
    missingKeywords: missing.map((m) => m.term),
    missingHardSkills: missing.filter((m) => m.hard).map((m) => m.term),
    jobKeywords: jobKeywords.map((k) => k.term),
    checks: {
      hasEmail,
      hasPhone,
      sections: sec,
      wordCount: wc,
      estimatedPages,
    },
  };
}

function detectSections(resumeJson, resumeText) {
  if (resumeJson) {
    return {
      summary: !!(resumeJson.summary && String(resumeJson.summary).trim()),
      experience: Array.isArray(resumeJson.experience) && resumeJson.experience.length > 0,
      skills:
        (Array.isArray(resumeJson.skillGroups) && resumeJson.skillGroups.length > 0) ||
        (Array.isArray(resumeJson.skills) && resumeJson.skills.length > 0) ||
        (!!resumeJson.skills && typeof resumeJson.skills === "object"),
      education: Array.isArray(resumeJson.education) && resumeJson.education.length > 0,
    };
  }
  const t = lc(resumeText);
  return {
    summary: /\b(summary|profile|objective)\b/.test(t),
    experience: /\b(experience|employment|work history)\b/.test(t),
    skills: /\b(skills|technologies|competencies)\b/.test(t),
    education: /\b(education|degree|university|bachelor|master)\b/.test(t),
  };
}

/** Flatten a structured resume.json into scannable plain text for scoring. */
function flattenResume(resume) {
  if (!resume) return "";
  const out = [];
  if (resume.name) out.push(resume.name);
  if (resume.targetTitle || resume.headline) out.push(resume.targetTitle || resume.headline);
  if (resume.contact) out.push(Object.values(resume.contact).filter(Boolean).join(" "));
  if (resume.summary) out.push(resume.summary);

  if (Array.isArray(resume.skills)) {
    out.push(resume.skills.join(", "));
  } else if (resume.skills && typeof resume.skills === "object") {
    for (const v of Object.values(resume.skills)) {
      out.push(Array.isArray(v) ? v.join(", ") : String(v));
    }
  }
  if (Array.isArray(resume.skillGroups)) {
    for (const g of resume.skillGroups) out.push((g.items || []).join(", "));
  }

  for (const e of resume.experience || []) {
    out.push([e.role, e.company, e.location, e.start, e.end].filter(Boolean).join(" "));
    for (const b of e.bullets || []) out.push(b);
  }
  for (const p of resume.projects || []) {
    out.push([p.name, p.description].filter(Boolean).join(" "));
    for (const b of p.bullets || []) out.push(b);
  }
  for (const ed of resume.education || []) {
    out.push([ed.degree, ed.school, ed.location, ed.details].filter(Boolean).join(" "));
  }
  for (const c of resume.certifications || []) {
    out.push(typeof c === "string" ? c : [c.name, c.issuer].filter(Boolean).join(" "));
  }
  for (const x of resume.extras || []) {
    out.push(x.heading + " " + (Array.isArray(x.items) ? x.items.join(", ") : x.content || ""));
  }
  return out.filter(Boolean).join("\n");
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

module.exports = { scoreResume, extractJobKeywords, flattenResume, containsTerm };

// ---- CLI: node src/atsScore.js <runId> ---------------------------------
if (require.main === module) {
  const runId = process.argv[2];
  if (!runId) {
    console.error("usage: node src/atsScore.js <runId>");
    process.exit(1);
  }
  const runDir = path.join(ROOT, "runs", runId);
  const resumeJsonPath = path.join(runDir, "work", "resume.json");
  const jobPath = path.join(runDir, "inputs", "job.txt");

  if (!fs.existsSync(resumeJsonPath)) {
    console.error(`missing ${resumeJsonPath} — the agent must write work/resume.json first`);
    process.exit(1);
  }
  const resume = JSON.parse(fs.readFileSync(resumeJsonPath, "utf8"));
  const jobText = fs.existsSync(jobPath) ? fs.readFileSync(jobPath, "utf8") : "";
  const resumeText = flattenResume(resume);

  const result = scoreResume({
    resumeText,
    jobText,
    jobTitle: resume.targetTitle || resume.headline,
    resumeJson: resume,
  });

  fs.mkdirSync(path.join(runDir, "work"), { recursive: true });
  fs.writeFileSync(
    path.join(runDir, "work", "ats.json"),
    JSON.stringify(result, null, 2)
  );

  console.log(
    JSON.stringify(
      {
        score: result.score,
        breakdown: result.breakdown.points,
        missingHardSkills: result.missingHardSkills,
        missingKeywords: result.missingKeywords.slice(0, 25),
      },
      null,
      2
    )
  );
}
