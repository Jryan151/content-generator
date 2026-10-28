// lib/prompts/footage.js — the clip check: how a stock clip is scored for one scene.
// Several candidate clips (their thumbnails) are scored side by side, 1-5, against what the scene
// should show (the script's "see" for that scene), the caption over it, and who should be in it.
// stages/vision.js sends it; stages/broll.js takes a clip scored GOOD (4) at once, or after a few
// searches the best one scored OK (3) or better.

export const clipScale = (people = true) => `Score each clip from 1 to 5:
5 = shows what the scene should show: ${people ? 'the right people in that moment, believable and everyday' : 'a believable, well-made shot of exactly that'}.
4 = close: the right ${people ? 'people in a similar moment' : 'kind of shot'}, and it suits the caption.
3 = usable: nothing wrong with it, but it doesn't really show what the scene is about.
2 = weak: noticeably off (clearly the wrong age group for the main person, an odd setting, a mood that fights the caption).
1 = never use. Give 1 if ANY of these is true:
${people ? '  - no person is visible (hands doing something real, like holding paperwork, are fine)\n' : ''}  - religious or sacred objects, clothing, places or rituals
  - hospitals, medical equipment, funerals, cemeteries, caskets, or people crying or grieving
  - anything suggestive (people in bed, partial nudity, swimwear)
  - on-screen text, logos, watermarks, or a green screen / studio backdrop
  - animals as the subject${people ? ', or scenery with no people' : ''}
  - stereotyped or costume-like cultural imagery
Judge the MAIN person's age only. Other people of any age in the shot are fine (grandkids, adult children).
If an age or detail is hard to tell from a small image, don't mark it down for that.`;

export const clipCheckSystem = place => `You pick stock footage for short Instagram videos by a licensed life insurance agent${place ? ` in ${place}` : ''}. The footage must look respectful and believable to the agent's clients, and it must show what each line is about: footage that only sets a mood makes a video feel random. Be fair: an ordinary shot of the right people doing what the scene describes deserves a 4 or 5.`;

// The text sent with the thumbnails for one scene.
export function clipCheckText({ caption, see = '', visual, keyword, shot = null, manual = false, people = true, count }) {
  const want = shot ? `\nThe shot should be ${shot.label.toLowerCase()}: ${shot.about}. A clip that is clearly a different kind of shot scores at most 3.` : manual ? '\nThe agent typed this search: match what it asks for, with or without people.' : '';
  return `${see ? `What this scene should show: ${see}\n` : ''}Caption shown over the shot: "${caption}"
${people || shot?.human ? `People who should appear: ${visual || 'adults'}` : `If people appear, they should match: ${visual || 'adults'}`}
Search used: "${keyword}"${want}

${clipScale(people)}

There are ${count} clips, numbered in order.
Return ONLY JSON: {"clips":[{"n":1,"score":1-5,"reason":"a few words"}]}`;
}
