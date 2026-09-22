// Shared by the Node relay and Next routes. No authoritative state is cached.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function atomicWrite(target, content) {
  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  const temporary = `${target}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    const fd = fs.openSync(temporary, 'wx', 0o600);
    try { fs.writeFileSync(fd, content); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fs.renameSync(temporary, target);
  } finally {
    try { fs.unlinkSync(temporary); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
}
function readJson(target, fallback) {
  try { return JSON.parse(fs.readFileSync(target, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return fallback; throw error; }
}
function writeJson(target, value) { atomicWrite(target, `${JSON.stringify(value, null, 2)}\n`); }
module.exports = { atomicWrite, readJson, writeJson };
