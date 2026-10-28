// niches/index.js — the niches the engine knows. A workspace's config names its niche (cfg.niche);
// anything without one is life insurance, so every existing agent works exactly as before.
// To add a niche: copy life-insurance.js, change its content, and add it here. (Starter facts for
// setup live in templates.js; a new niche also needs its own templates there.)
import lifeInsurance from './life-insurance.js';

export const NICHES = { [lifeInsurance.id]: lifeInsurance };
export const DEFAULT_NICHE = lifeInsurance.id;
export const nicheOf = cfg => NICHES[cfg?.niche] || NICHES[DEFAULT_NICHE];
export const nicheList = () => Object.values(NICHES).map(n => ({ id: n.id, label: n.label }));
