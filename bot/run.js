#!/usr/bin/env node
// Entry point: node bot/run.js [--dry-run]
require('./core').run(require('./platform')).then(code => { process.exitCode = code; }, err => { console.error(err); process.exitCode = 1; });
