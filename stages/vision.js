// stages/vision.js — the AI clip check.
// Looks at several candidate clips for one scene at once (their thumbnails) and scores each
// 1-5 for how well it fits the caption and the audience. Comparing side by side is more
// reliable than judging one clip at a time, and one call per scene costs less.
// If the call itself fails, it returns null and the clip is marked "unchecked".
import { chatJSON } from '../lib/ai.js';

export const clipScale = (people = true) => `Score each clip from 1 to 5:
5 = a great fit: ${people ? 'the right people, a believable everyday moment' : 'a believable, well-made shot of what the search asks for'} that suits the caption.
4 = a good fit.
3 = acceptable: fine to use, nothing wrong, just not a close match.
2 = weak: noticeably off (clearly the wrong age group for the main person, or an odd setting).
1 = never use. Give 1 if ANY of these is true:
${people ? '  - no person is visible (hands doing something real, like holding paperwork, are fine)\n' : ''}  - religious or sacred objects, clothing, places or rituals
  - hospitals, medical equipment, funerals, cemeteries, caskets, or people crying or grieving
  - anything suggestive (people in bed, partial nudity, swimwear)
  - on-screen text, logos, watermarks, or a green screen / studio backdrop
  - animals as the subject${people ? ', or scenery with no people' : ''}
  - stereotyped or costume-like cultural imagery
Judge the MAIN person's age only. Other people of any age in the shot are fine (grandkids, adult children).
If an age or detail is hard to tell from a small image, don't mark it down for that.`;

// clips: [{ image }]. Returns [{ score, reason }] in the same order, or null if the check failed.
// `shot`: the kind of shot the plan asked for ({ label, about, human }), scored too. Shots that
// aren't people shots (a street, a photo frame, light), and searches the agent typed (`manual`),
// don't need a person in them.
export async function rankClips({ clips, caption, visual, keyword, place = '', meter = null, shot = null, manual = false }) {
  const usable = clips.filter(c => c.image);
  if (!usable.length) return null;
  const people = !manual && (!shot || shot.human);
  try {
    const want = shot ? `\nThe shot should be ${shot.label.toLowerCase()}: ${shot.about}. A clip that is clearly a different kind of shot scores at most 3.` : manual ? '\nThe agent typed this search: match what it asks for, with or without people.' : '';
    const content = [{ type: 'text', text: `Caption shown over the shot: "${caption}"\n${people || shot?.human ? `People who should appear: ${visual || 'adults'}` : `If people appear, they should match: ${visual || 'adults'}`}\nSearch used: "${keyword}"${want}\n\n${clipScale(people)}\n\nThere are ${usable.length} clips, numbered in order.\nReturn ONLY JSON: {"clips":[{"n":1,"score":1-5,"reason":"a few words"}]}` }];
    usable.forEach((c, i) => { content.push({ type: 'text', text: `Clip ${i + 1}:` }, { type: 'image_url', image_url: { url: c.image, detail: 'low' } }); });
    const text = await chatJSON({
      job: 'vision',
      temperature: 0, maxTokens: 60 + 40 * usable.length, meter,
      messages: [
        { role: 'system', content: `You pick stock footage for short Instagram videos by a licensed life insurance agent${place ? ` in ${place}` : ''}. The footage must look respectful and believable to the agent's clients. Be fair: most ordinary shots of the right people deserve a 3 or better.` },
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
