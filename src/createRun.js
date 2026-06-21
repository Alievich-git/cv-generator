"use strict";

const path = require("path");
const { createRunScaffold } = require("./runStore");

const ROOT = path.resolve(__dirname, "..");
const RUNS = path.join(ROOT, "runs");

const [, , accentColor, pageSize, targetScore] = process.argv;
const result = createRunScaffold(RUNS, { accentColor, pageSize, targetScore });

console.log(result.runId);
