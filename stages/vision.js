// stages/vision.js — the AI clip check.
// Looks at several candidate clips for one scene at once (their thumbnails) and scores each
// 1-5 for how well it shows what the scene is about (lib/prompts/footage.js). Comparing side by side is more
// reliable than judging one clip at a time, and one call per scene costs less.
// If the call itself fails, it returns null and the clip is marked "unchecked".
import { chatJSON } from '../lib/ai.js';
import { clipScale, clipCheckSystem, clipCheckText } from '../lib/prompts/footage.js';

// The prompt text is in lib/prompts/footage.js.
export { clipScale };

// clips: [{ image }]. Returns [{ score, reason }] in the same order, or null if the check failed.
// `shot`: the kind of shot the plan asked for ({ label, about, human }), scored too. Shots that
// aren't people shots (a street, a photo frame, light), and searches the agent typed (`manual`),
// don't need a person in them.
export async function rankClips({ clips, caption, see = '', visual, keyword, place = '', meter = null, shot = null, manual = false }) {
  const usable = clips.filter(c => c.image);
  if (!usable.length) return null;
  const people = !manual && (!shot || shot.human);
  try {
    const content = [{ type: 'text', text: clipCheckText({ caption, see, visual, keyword, shot, manual, people, count: usable.length }) }];
    usable.forEach((c, i) => { content.push({ type: 'text', text: `Clip ${i + 1}:` }, { type: 'image_url', image_url: { url: c.image, detail: 'low' } }); });
    const text = await chatJSON({
      job: 'vision',
      temperature: 0, maxTokens: 60 + 40 * usable.length, meter,
      messages: [
        { role: 'system', content: clipCheckSystem(place) },
        { role: 'user', content },
      ],
    });
    const out = JSON.parse(text).clips || [];
    let k = 0;
    return clips.map(c => {
      if (!c.image) return { score: 0, reason: 'no thumbnail' };
      const r = out.find(x => Number(x.n) === k + 1) || out[k] || {};
      k++;
      return { score: Math.max(1, Math.min(5, Math.round(Number(r.score) || 1))), reason: String(r.reason || '').slice(0, 100) };
    });
  } catch {
    return null;
  }
}

// Pixabay gives each video size a thumbnail image.
export const thumbnailOf = hit => {
  const v = hit.videos || {};
  return v.medium?.thumbnail || v.small?.thumbnail || v.large?.thumbnail || v.tiny?.thumbnail || null;
};
