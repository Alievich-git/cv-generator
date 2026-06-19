"use strict";

/**
 * Render a tailored resume.json into:
 *   - runs/<id>/output/resume.html  (standalone, inlined CSS, for preview)
 *   - runs/<id>/output/resume.pdf   (selectable text, ATS-safe, via Puppeteer)
 *
 * The structure lives in template/resume.html (placeholders) and the styling
 * in template/resume.css. Repeated sections are generated here and injected.
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");

// Guardrail: no em dashes (or horizontal bars) in the final output, even if the
// source resume uses them. En dashes (U+2013) are kept for date ranges.
function stripEmDashes(s) {
  return String(s)
    .replace(/\s*[\u2014\u2015]\s*/g, ", ")
    .replace(/\s+,/g, ",")
    .replace(/,\s*,/g, ",");
}

function esc(s) {
  return stripEmDashes(String(s == null ? "" : s))
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function sanitizeColor(c) {
  if (typeof c === "string" && /^#?[0-9a-fA-F]{3,8}$/.test(c.trim())) {
    const v = c.trim();
    return v.startsWith("#") ? v : "#" + v;
  }
  return "#1f4d7a";
}

function section(title, inner, extraClass) {
  if (!inner || !inner.trim()) return "";
  return `<section class="section ${extraClass || ""}">\n  <h2>${esc(title)}</h2>\n  ${inner}\n</section>`;
}

function buildContact(resume) {
  const c = resume.contact || {};
  const parts = [];
  if (c.location) parts.push(esc(c.location));
  if (c.phone) parts.push(esc(c.phone));
  if (c.email) parts.push(`<a href="mailto:${esc(c.email)}">${esc(c.email)}</a>`);
  if (c.linkedin) parts.push(linkPart(c.linkedin));
  if (c.github) parts.push(linkPart(c.github));
  if (c.website) parts.push(linkPart(c.website));
  if (c.portfolio) parts.push(linkPart(c.portfolio));
  return parts.join('<span class="sep">|</span>');
}

function linkPart(url) {
  const display = String(url).replace(/^https?:\/\//, "").replace(/\/$/, "");
  const href = /^https?:\/\//.test(url) ? url : "https://" + url;
  return `<a href="${esc(href)}">${esc(display)}</a>`;
}

function buildSummary(resume) {
  if (!resume.summary) return "";
  return section("Summary", `<div class="summary"><p>${esc(resume.summary)}</p></div>`);
}

function normalizeSkillGroups(resume) {
  // accept: skillGroups:[{category,items}], skills:{cat:[...]}, skills:[...]
  if (Array.isArray(resume.skillGroups) && resume.skillGroups.length) {
    return resume.skillGroups.map((g) => ({
      category: g.category || g.name || "",
      items: g.items || [],
    }));
  }
  if (resume.skills && !Array.isArray(resume.skills) && typeof resume.skills === "object") {
    return Object.entries(resume.skills).map(([category, items]) => ({
      category,
      items: Array.isArray(items) ? items : [items],
    }));
  }
  if (Array.isArray(resume.skills) && resume.skills.length) {
    return [{ category: "", items: resume.skills }];
  }
  return [];
}

function buildSkills(resume) {
  const groups = normalizeSkillGroups(resume);
  if (!groups.length) return "";
  const rows = groups
    .filter((g) => g.items && g.items.length)
    .map((g) => {
      const items = g.items.map(esc).join(", ");
      return g.category
        ? `<p class="skill-row"><span class="skill-cat">${esc(g.category)}:</span> ${items}</p>`
        : `<p class="skill-row">${items}</p>`;
    })
    .join("\n  ");
  return section("Skills", `<div class="skills-grid">${rows}</div>`);
}

function buildEntries(items) {
  return (items || [])
    .map((e) => {
      const left = [
        e.role ? `<span class="entry-title">${esc(e.role)}</span>` : "",
        e.company ? `<span class="entry-org">${e.role ? ", " : ""}${esc(e.company)}</span>` : "",
      ].join("");
      const dates = [e.start, e.end].filter(Boolean).join(" – ");
      const headRight = dates ? `<span class="entry-dates">${esc(dates)}</span>` : "";
      const sub = e.location ? `<div class="entry-sub">${esc(e.location)}</div>` : "";
      const bullets = (e.bullets || []).length
        ? `<ul class="bullets">${e.bullets.map((b) => `<li>${esc(b)}</li>`).join("")}</ul>`
        : "";
      return `<div class="entry">
    <div class="entry-head"><div>${left}</div>${headRight}</div>
    ${sub}
    ${bullets}
  </div>`;
    })
    .join("\n  ");
}

function buildExperience(resume) {
  if (!Array.isArray(resume.experience) || !resume.experience.length) return "";
  return section("Experience", buildEntries(resume.experience));
}

function buildProjects(resume) {
  if (!Array.isArray(resume.projects) || !resume.projects.length) return "";
  const inner = resume.projects
    .map((p) => {
      const name = p.name ? `<span class="entry-title">${esc(p.name)}</span>` : "";
      const link = p.link ? `<span class="entry-dates">${linkPart(p.link)}</span>` : "";
      const desc = p.description ? `<div class="entry-sub">${esc(p.description)}</div>` : "";
      const bullets = (p.bullets || []).length
        ? `<ul class="bullets">${p.bullets.map((b) => `<li>${esc(b)}</li>`).join("")}</ul>`
        : "";
      return `<div class="entry"><div class="entry-head"><div>${name}</div>${link}</div>${desc}${bullets}</div>`;
    })
    .join("\n  ");
  return section("Projects", inner);
}

function buildEducation(resume) {
  if (!Array.isArray(resume.education) || !resume.education.length) return "";
  const inner = resume.education
    .map((ed) => {
      const left = [
        ed.degree ? `<span class="entry-title">${esc(ed.degree)}</span>` : "",
        ed.school ? `<span class="entry-org">${ed.degree ? ", " : ""}${esc(ed.school)}</span>` : "",
      ].join("");
      const dates = [ed.start, ed.end].filter(Boolean).join(" – ");
      const right = dates ? `<span class="entry-dates">${esc(dates)}</span>` : "";
      const details = ed.details ? `<div class="entry-sub">${esc(ed.details)}</div>` : "";
      return `<div class="edu-entry"><div class="entry-head"><div>${left}</div>${right}</div>${details}</div>`;
    })
    .join("\n  ");
  return section("Education", inner);
}

function buildCertifications(resume) {
  if (!Array.isArray(resume.certifications) || !resume.certifications.length) return "";
  const items = resume.certifications
    .map((c) => {
      if (typeof c === "string") return `<li>${esc(c)}</li>`;
      const d = [c.name, c.issuer, c.date].filter(Boolean).map(esc).join(", ");
      return `<li>${d}</li>`;
    })
    .join("");
  return section("Certifications", `<ul class="bullets">${items}</ul>`);
}

function buildExtras(resume) {
  if (!Array.isArray(resume.extras) || !resume.extras.length) return "";
  return resume.extras
    .map((x) => {
      let inner = "";
      if (Array.isArray(x.bullets) && x.bullets.length) {
        inner = `<ul class="bullets">${x.bullets.map((b) => `<li>${esc(b)}</li>`).join("")}</ul>`;
      } else if (Array.isArray(x.items) && x.items.length) {
        inner = `<p class="list-inline">${x.items.map(esc).join(", ")}</p>`;
      } else if (x.content) {
        inner = `<p class="list-inline">${esc(x.content)}</p>`;
      }
      return section(x.heading || "Additional", inner);
    })
    .join("\n");
}

function buildHtml(resume) {
  const css = fs.readFileSync(path.join(ROOT, "template", "resume.css"), "utf8");
  let tpl = fs.readFileSync(path.join(ROOT, "template", "resume.html"), "utf8");

  const headline = resume.headline || resume.targetTitle || "";
  const map = {
    "{{CSS}}": css,
    "{{ACCENT}}": sanitizeColor(resume.accentColor),
    "{{NAME}}": esc(resume.name || "Your Name"),
    "{{HEADLINE}}": headline ? `<div class="headline">${esc(headline)}</div>` : "",
    "{{CONTACT}}": buildContact(resume),
    "{{SUMMARY}}": buildSummary(resume),
    "{{SKILLS}}": buildSkills(resume),
    "{{EXPERIENCE}}": buildExperience(resume),
    "{{PROJECTS}}": buildProjects(resume),
    "{{EDUCATION}}": buildEducation(resume),
    "{{CERTIFICATIONS}}": buildCertifications(resume),
    "{{EXTRAS}}": buildExtras(resume),
  };

  for (const [k, v] of Object.entries(map)) {
    tpl = tpl.split(k).join(v);
  }
  return tpl;
}

async function renderRun(runId) {
  const runDir = path.join(ROOT, "runs", runId);
  const resumePath = path.join(runDir, "work", "resume.json");
  if (!fs.existsSync(resumePath)) {
    throw new Error(`missing ${resumePath} — the agent must write work/resume.json first`);
  }
  const resume = JSON.parse(fs.readFileSync(resumePath, "utf8"));

  const html = buildHtml(resume);
  const outDir = path.join(runDir, "output");
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "resume.html"), html);

  const puppeteer = require("puppeteer");
  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0" });

    // Auto-fit: if the resume is just over one page, scale it down enough to fit
    // cleanly (with a floor so text never gets too small). Genuinely large
    // resumes are left to flow onto a second page.
    const marginIn = 0.5;
    const pageHeightIn = resume.pageSize === "A4" ? 11.69 : 11;
    const usablePx = (pageHeightIn - 2 * marginIn) * 96;
    const contentPx = await page.evaluate(() =>
      Math.ceil(document.querySelector(".resume").getBoundingClientRect().height)
    );
    if (contentPx > usablePx) {
      const zoom = Math.max(0.84, (usablePx * 0.985) / contentPx);
      await page.evaluate((z) => {
        document.body.style.zoom = String(z);
      }, zoom);
    }

    await page.pdf({
      path: path.join(outDir, "resume.pdf"),
      format: resume.pageSize === "A4" ? "A4" : "Letter",
      printBackground: true,
      margin: { top: "0.5in", bottom: "0.5in", left: "0.55in", right: "0.55in" },
    });
  } finally {
    await browser.close();
  }
  return { pdf: "output/resume.pdf", html: "output/resume.html" };
}

module.exports = { renderRun, buildHtml };

// ---- CLI: node src/render.js <runId> -----------------------------------
if (require.main === module) {
  const runId = process.argv[2];
  if (!runId) {
    console.error("usage: node src/render.js <runId>");
    process.exit(1);
  }
  renderRun(runId)
    .then((r) => console.log("rendered " + JSON.stringify(r)))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
