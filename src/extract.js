"use strict";

const fs = require("fs");
const path = require("path");

/**
 * Extract plain text from an uploaded resume file.
 * Supports PDF, DOCX, and plain text / markdown. Falls back to UTF-8.
 * @param {string} filePath absolute path to the file
 * @returns {Promise<string>} cleaned plain text
 */
async function extractText(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const buffer = fs.readFileSync(filePath);

  if (ext === ".pdf") {
    // pdf-parse v2 exposes a PDFParse class (not a default function).
    const { PDFParse } = require("pdf-parse");
    const parser = new PDFParse({ data: new Uint8Array(buffer) });
    try {
      const result = await parser.getText();
      return cleanText(result.text);
    } finally {
      if (typeof parser.destroy === "function") {
        await parser.destroy();
      }
    }
  }

  if (ext === ".docx") {
    const mammoth = require("mammoth");
    const result = await mammoth.extractRawText({ buffer });
    return cleanText(result.value);
  }

  // .txt, .md, .rtf (best effort), .doc (best effort) and anything else
  return cleanText(buffer.toString("utf8"));
}

/**
 * Normalize whitespace without destroying paragraph structure.
 */
function cleanText(t) {
  if (!t) return "";
  return t
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\u0000/g, "")
    .replace(/\t/g, "  ")
    .replace(/[ \u00a0]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

module.exports = { extractText, cleanText };
