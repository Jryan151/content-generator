// Shared page state: which mode is on (your own setup or the demo) and the
// leader's current system, so every screen reads the same answers.
export const state = { mode: 'mine', system: null, setup: null };
const subs = { mode: new Set(), system: new Set() };

export function setMode(mode) {
  if (state.mode === mode) return;
  state.mode = mode;
  subs.mode.forEach((fn) => fn(mode));
}
export function setSystem(setup, system) {
  state.setup = setup; state.system = system;
  subs.system.forEach((fn) => fn(system));
}
export const onMode = (fn) => subs.mode.add(fn);
export const onSystem = (fn) => subs.system.add(fn);
