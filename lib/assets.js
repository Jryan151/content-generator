// lib/assets.js — the start-up check of the files the videos are made from (v15: "everything ships in
// the box, and is checked").
//   Fonts: each against the SHA-256 it was released with (stages/fonts.js). A mismatched one is put back
//   from the release; one that can't be is removed (it's fetched again, checked, before the next render).
//   Music: your own tracks in music/ (they don't ship with the app; they're yours). Each track's SHA-256
//   is noted the first time it's seen (data/music.json); a track whose bytes later change (a disk fault,
//   a bad copy) is reported once, so a video never goes out with a damaged track unnoticed.
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { DIRS, readJSON, writeJSON } from './paths.js';
import { checkFonts } from '../stages/fonts.js';

const MUSIC = () => path.join(DIRS.data, 'music.json');
const shaOfFile = p => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');

export function checkMusic(now = Date.now()) {
  const out = { tracks: 0, added: [], changed: [], gone: [] };
  let names = [];
  try { names = fs.readdirSync(DIRS.music).filter(n => /\.(mp3|m4a|wav|aac|ogg)$/i.test(n)); } catch { return out; }
  const known = readJSON(MUSIC(), {}) || {}, next = {};
  for (const n of names) {
    let sha;
    try { sha = shaOfFile(path.join(DIRS.music, n)); } catch { continue; }
    out.tracks++;
    if (!known[n]) out.added.push(n);
    else if (known[n].sha !== sha) out.changed.push(n);
    next[n] = { sha, at: known[n]?.sha === sha ? known[n].at : new Date(now).toISOString() };
  }
  out.gone = Object.keys(known).filter(n => !next[n]);
  writeJSON(MUSIC(), next);
  return out;
}

export function checkAssets(now = Date.now()) {
  let fonts;
  try { fonts = checkFonts(); } catch (e) { fonts = { ok: [], fixed: [], bad: [], error: e.message }; }
  return { fonts, music: checkMusic(now) };
}
