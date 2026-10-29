// The Agent System page (/agent-system/) runs its engine in the browser, and the server only serves
// files it lists (STATIC in server.js). This follows every script the page loads, and every module
// those import, and fails if one isn't served or is served from the wrong file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const server = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
const served = Object.fromEntries([...server.matchAll(/'(\/agent-system\/[^']*)': \['([^']+)'/g)].map((m) => [m[1], m[2]]));

test('every file the Agent System page loads is served, from the right place', () => {
  assert.equal(served['/agent-system/'], 'agent-system/public/index.html');
  const html = fs.readFileSync(path.join(ROOT, served['/agent-system/']), 'utf8');
  const queue = [...html.matchAll(/<script[^>]*\bsrc="([^"]+)"/g)].map((m) => new URL(m[1], 'https://x/agent-system/').pathname);
  assert.ok(queue.length > 0, 'the page loads no scripts');
  const seen = new Set();
  while (queue.length) {
    const url = queue.shift();
    if (seen.has(url)) continue;
    seen.add(url);
    const file = served[url];
    assert.ok(file, `${url} is loaded by the page but not served`);
    assert.ok(fs.existsSync(path.join(ROOT, file)), `${url} points at ${file}, which doesn't exist`);
    const code = fs.readFileSync(path.join(ROOT, file), 'utf8');
    for (const m of code.matchAll(/(?:^|\n)\s*import\s[^'"]*?from\s+'(\.{1,2}\/[^']+)'|import\('(\.{1,2}\/[^']+)'\)/g)) {
      queue.push(new URL(m[1] || m[2], `https://x${url}`).pathname);
    }
  }
  assert.ok(seen.size >= 10, `only ${seen.size} files followed`);
});

test('nothing served under /agent-system/ points at a missing file', () => {
  for (const [url, file] of Object.entries(served)) assert.ok(fs.existsSync(path.join(ROOT, file)), `${url} → ${file} is missing`);
});
