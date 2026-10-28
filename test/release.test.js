// Version 12 release: version number, help link, link previews for the landing page.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { tempEnv, client, portalSource } from './helpers.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
tempEnv();
process.env.PUBLIC_URL = '';
const { start, VERSION } = await import('../server.js');
const server = await start({ port: 0, scheduler: false, worker: false });
const c = client(server.address().port);
test.after(() => server.close());

test('release: version 15.0.0 everywhere', async () => {
  assert.equal(VERSION, '15.0.0');
  assert.equal(JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version, '15.0.0');
  assert.equal((await c.get('/api/me')).data.version, '15.0.0');
  assert.match(fs.readFileSync(path.join(ROOT, 'SETUP.md'), 'utf8'), /^# Agent Reels 15/);
  assert.doesNotMatch(fs.readFileSync(path.join(ROOT, 'SETUP.md'), 'utf8'), /being built in steps/);
});

test('release: a Get help button when SUPPORT_EMAIL is set', async () => {
  assert.equal((await c.get('/api/me')).data.support, '');
  process.env.SUPPORT_EMAIL = 'help@agentreels.example';
  try { assert.equal((await c.get('/api/me')).data.support, 'help@agentreels.example'); }
  finally { delete process.env.SUPPORT_EMAIL; }
  assert.match(portalSource(), /Get help/);
});
