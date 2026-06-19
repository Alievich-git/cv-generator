"use strict";

/**
 * Chat helper for the agent (the engine). The browser and this CLI share a
 * simple file protocol so the user and the agent can collaborate after the
 * first draft is ready:
 *
 *   runs/<id>/chat/thread.json     the full conversation (written here)
 *   runs/<id>/chat/inbox/*.json    user messages waiting to be handled
 *
 * Usage (run from the repo root):
 *   node src/chat.js <id> ask "Question one?" "Question two?"   # assistant asks
 *   node src/chat.js <id> say "Done — I shortened the summary." # assistant reply
 *   node src/chat.js <id> consume                               # pull + print user msgs
 *
 * `consume` moves every pending user message into the thread (so it shows in
 * the UI immediately) and prints them so you know what to act on. After you
 * edit work/resume.json and re-render, post a `say` reply.
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");

function dir(id) {
  return path.join(ROOT, "runs", id, "chat");
}
function threadPath(id) {
  return path.join(dir(id), "thread.json");
}
function readThread(id) {
  try {
    return JSON.parse(fs.readFileSync(threadPath(id), "utf8"));
  } catch (_) {
    return [];
  }
}
function writeThread(id, thread) {
  fs.mkdirSync(dir(id), { recursive: true });
  fs.writeFileSync(threadPath(id), JSON.stringify(thread, null, 2));
}
function mkId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}
function append(id, role, kind, text) {
  const t = readThread(id);
  t.push({ id: mkId(), role, kind, text: String(text), ts: Date.now() });
  writeThread(id, t);
}
function consume(id) {
  const inbox = path.join(dir(id), "inbox");
  let files = [];
  try {
    files = fs.readdirSync(inbox).filter((f) => f.endsWith(".json")).sort();
  } catch (_) {
    return [];
  }
  const t = readThread(id);
  const texts = [];
  for (const f of files) {
    const fp = path.join(inbox, f);
    try {
      const m = JSON.parse(fs.readFileSync(fp, "utf8"));
      t.push({ id: m.id || mkId(), role: "user", kind: "message", text: m.text, ts: m.ts || Date.now() });
      texts.push(m.text);
    } catch (_) {}
    try {
      fs.unlinkSync(fp);
    } catch (_) {}
  }
  if (texts.length) writeThread(id, t);
  return texts;
}

const [, , id, cmd, ...rest] = process.argv;
if (!id || !cmd) {
  console.error('usage: node src/chat.js <id> <ask|say|consume> ["text" ...]');
  process.exit(1);
}

if (cmd === "ask") {
  if (!rest.length) {
    console.error('ask needs at least one question, e.g. node src/chat.js ID ask "..."');
    process.exit(1);
  }
  rest.forEach((q) => append(id, "assistant", "question", q));
  console.log(`asked ${rest.length} question(s) on ${id}`);
} else if (cmd === "say") {
  append(id, "assistant", "reply", rest.join(" "));
  console.log(`replied on ${id}`);
} else if (cmd === "consume") {
  const texts = consume(id);
  if (!texts.length) console.log("(no pending messages)");
  else texts.forEach((t) => console.log("USER: " + t));
} else {
  console.error("unknown command: " + cmd);
  process.exit(1);
}
