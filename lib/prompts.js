// lib/prompts.js — the door to every prompt a video is made with (the files are in lib/prompts/):
//   script.js    the script: what the video is, each scene's job, how it sounds, its footage
//   hooks.js     eight openings, and the critic that ranks them
//   critic.js    picks the best of the drafts that passed the checks
//   post.js      the post text under the Reel
//   footage.js   the clip check: what a good clip for a scene looks like
//   examples.js  short scripts that set how a script should sound
//   shared.js    helpers, and the sound rules every script follows
// Server only: these files are never sent to a browser, so the way prompts are written stays private.
// Agents see their settings and the checks (mixer-core.js); admins can preview a full prompt in
// Settings (POST /api/prompt-preview). The rules and validators stay in mixer-core.js, so the portal
// and server check scripts the same way.
export * from './prompts/script.js';
export * from './prompts/hooks.js';
export * from './prompts/critic.js';
export * from './prompts/post.js';
export * from './prompts/footage.js';
export { EXAMPLES, exampleFor } from './prompts/examples.js';
export { SOUND_RULES } from './prompts/shared.js';
