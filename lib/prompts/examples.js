// lib/prompts/examples.js — what a good script sounds like.
// One short example is the strongest way to set the feel of a script: how plain the words are, how each
// scene follows the last, how the ending opens the viewer's own question. Each one is written to pass
// the checks (qualifiers kept, no numbers, no promises, ten words or fewer a scene), on a classic
// six-scene shape.
//
// They set the feel only. The prompt says never to reuse their words, and the writer gets one whose
// subject is different from the video's, so it can't borrow the content. Scripts the agent approved
// (lib/prompts/script.js "SCRIPTS … APPROVED") come first when there are any: her own taste beats these.
export const EXAMPLES = [
  {
    id: 'work', about: /\b(?:work|job|retire|employer)\b/i, format: 'question',
    scenes: [
      'You have life insurance through work. So you’re covered, right?',
      'Work coverage often ends when you retire or leave.',
      'The plan you count on may not stay with you.',
      'A policy you own stays yours, separate from your job.',
      'Whether yours would last depends on your own plan.',
      'Message me and I’ll help you look at yours.',
    ],
  },
  {
    id: 'health', about: /\b(?:health|exam|medical|turned down|qualif)\w*/i, format: 'myth',
    scenes: [
      'A lot of folks think health problems mean no coverage.',
      'Many final expense policies ask a few health questions.',
      'They usually skip the medical exam.',
      'It’s a small policy meant to cover final expenses.',
      'What you could apply for depends on your health history.',
      'Send me a message and we’ll go over it together.',
    ],
  },
  {
    id: 'premium', about: /\b(?:premium|same|price|go up|older)\b/i, format: 'didyouknow',
    scenes: [
      'Most people expect insurance to cost more every year.',
      'With whole life final expense, premiums usually stay the same.',
      'What you start paying is usually what you keep paying.',
      'That’s how a small whole life policy is built.',
      'What would fit you depends on your situation.',
      'Message me and I’ll walk you through it.',
    ],
  },
];

// An example on a different subject than this video's facts and worry (so its words can't be borrowed).
export function exampleFor(picks) {
  const text = [picks?.painPoint?.text, ...(picks?.insights || []).map(i => i.text), picks?.insight?.text].filter(Boolean).join(' ');
  return EXAMPLES.find(e => !e.about.test(text)) || EXAMPLES[0];
}
