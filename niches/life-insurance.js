// niches/life-insurance.js — everything that makes the engine about life insurance: products,
// the compliance floor, wording that sounds government-backed, eligibility promises, absolute
// claims, footage words to avoid, and the phrases prompts use to describe the agent.
// The engine (mixer-core.js) and prompts read these through the workspace's niche (cfg.niche).
// Sent to browsers along with mixer-core.js: rules and labels only, never prompt-writing logic.
export default {
  id: 'life_insurance',
  label: 'Life insurance',
  // Who the videos are for, in prompts and the coach.
  agentNoun: 'a licensed life insurance agent',
  agentFor: title => (/agent|advisor|broker|producer/i.test(String(title || '').trim()) ? `a ${String(title).trim().toLowerCase()} who sells life insurance` : 'a licensed life insurance agent'),
  // What "government-backed" wording makes the product sound like, in check messages.
  govSubject: 'private insurance',
  // Examples of product terms the highlighted word should never be (prompt wording).
  productTermsExample: 'policy, insurance, whole life',

  productLines: [
    // `words`: wording that belongs to this product line (a line about another product gets a note, v15).
    { id: 'final_expense', label: 'Final expense', note: 'Older clients covering funeral and end-of-life costs', words: /\b(?:final expenses?|funerals?|burials?|end[- ]of[- ]life)\b/i },
    { id: 'mortgage', label: 'Mortgage protection', note: 'Homeowners keeping the house if something happens', words: /\b(?:mortgages?|house payments?|home loans?|mortgage protection)\b/i },
    { id: 'family', label: 'Family protection', note: 'Parents replacing income with term life', words: /\b(?:term (?:life|policy|policies|insurance|coverage)|income replacement|replace (?:your|their) income|young famil(?:y|ies)|early adulthood|new parents?|college funds?)\b/i },
  ],
  defaultProduct: 'Final expense',

  // Compliance floor for every agent in this niche. Agents can add rules; they can't remove these.
  platformGuardrails: {
    mustUse: [],
    neverUse: ['guaranteed', 'everyone qualifies', 'no questions asked', 'best plan', 'cheapest', 'secret', 'act now', 'limited time', 'risk-free', 'free insurance', 'free coverage', 'my client', 'my clients', 'one of my clients', 'a client of mine'],
    mustDo: ['Make clear that coverage depends on qualifying', 'Write only in English'],
    neverDo: [
      'Add numbers, prices or statistics that are not in the insight',
      'Invent urgency or use fear to pressure the viewer',
      'Give binding tax, legal or financial advice',
      'Say or imply that the viewer will qualify',
      'Suggest any connection to a government agency, program or benefit',
      'Name insurance companies or quote prices',
      'Tell a real or made-up client story',
      'Use emojis or hashtags',
    ],
  },
  // Language that makes private insurance sound government-backed (the most common complaint
  // about final expense ads aimed at seniors). Checked in code on every script and post.
  govTerms: [
    [/\bgovernment\b/i, 'government'],
    [/\bprograms?\b/i, 'program'],
    [/\bmedicare\b/i, 'Medicare'],
    [/\bmedicaid\b/i, 'Medicaid'],
    [/\bsocial security\b/i, 'Social Security'],
    [/\bstate[- ](?:approved|regulated|sponsored|backed|funded)\b/i, 'state-approved'],
    [/\bfederal(?:ly)?\b/i, 'federal'],
    [/\b(?:burial|final expense|funeral) benefits?\b/i, 'burial benefit'],
    [/\bveterans?(?:'|’)?s? (?:administration|benefits?)\b/i, 'veterans benefits'],
    [/\b(?:indian health service|tribal benefits?)\b/i, 'tribal or IHS benefits'],
  ],
  // Saying or implying the viewer will qualify.
  eligibility: [
    /(?<!what |if |whether )\byou(?:'ll|’ll| will)? (?:definitely |easily |still |surely )?(?:qualify|get approved|be approved|be covered)\b/i,
    /\byou can (?:still )?(?:get|be) (?:covered|approved)\b/i,
    /\banyone (?:can )?qualif/i,
  ],
  // Absolute claims that need the insight to back them up.
  absolutes: [
    [/\bno (?:medical )?exams?\b/i, 'no exam'],
    [/\bno health questions\b/i, 'no health questions'],
    [/\beveryone\b/i, 'everyone'],
    [/\banyone (?:can|will)\b/i, 'anyone can'],
    [/\balways\b/i, 'always'],
    [/\bnever (?:be )?(?:denied|turned down|rejected)\b/i, 'never denied'],
    [/\binstant(?:ly)? approv/i, 'instant approval'],
    [/\b(?:covers|pays for) (?:everything|all)\b/i, 'covers everything'],
  ],
  // Keywords that pull abstract or off-topic stock footage.
  abstractKeywords: ['insurance', 'security', 'protection', 'money', 'finance', 'plan', 'planning', 'policy', 'coverage', 'savings', 'budget', 'future', 'safety', 'trust', 'risk', 'health', 'cost', 'costs', 'abstract', 'concept', 'technology', 'data'],
  // Product and title words that are never the highlighted word (on top of the universal ones).
  accentBanned: ['policy', 'policies', 'insurance', 'whole', 'term', 'licensed', 'agent'],
  // The yearly calendar shown in Content → Worries: moments when certain worries hit home.
  // Tagging a worry with months makes it come up more often in those months (see roll()).
  seasons: [
    // `match`: words in a worry (or its audiences) that make it fit the moment, so it comes up more that
    // month without the agent tagging it (tagging it by hand still counts more).
    { months: [1], label: 'New year, fresh start', tip: 'Getting affairs in order, new-year plans, budgets reset.', match: 'plan|ready|budget|start|put(ting)? (it|this) off|affairs|organi[sz]e' },
    { months: [2], label: 'Valentine’s and couples', tip: 'Protecting the person you love; talking about it together.', match: 'spouse|husband|wife|partner|couple|married|love' },
    { months: [5], label: 'Mother’s Day', tip: 'Moms, grandmothers and what they’d want for the family.', match: 'mom|mother|grandmother|grandma|single parent' },
    { months: [6], label: 'Father’s Day', tip: 'Dads, providers, and the conversation many put off.', match: 'dad|father|grandfather|grandpa|provider|income' },
    { months: [9], label: 'Life Insurance Awareness Month', tip: 'September: a natural reason to start the conversation.' },
    { months: [11], label: 'Thanksgiving, families together', tip: 'Holidays bring families to one table: a good time to talk.', match: 'family|families|kids|children|grandkids|grandchildren|talk(ed)? about' },
    { months: [12], label: 'Holidays and year-end', tip: 'Family time, reflection and plans for next year.', match: 'family|families|kids|grandkids|next year|plan' },
  ],
  // Studio series: a short run of videos on one subject, each part with its own format. The agent picks
  // the worry and fact for each part; the series only sets the order and shape.
  series: [
    { id: 'fe101', label: 'Final Expense 101', product: 'final_expense', parts: [
      { title: 'What it is', format: 'didyouknow' }, { title: 'A common myth', format: 'myth' }, { title: 'A mistake to avoid', format: 'mistake' },
      { title: 'A question I get asked', format: 'asked' }, { title: 'Your next step', format: 'question' }] },
    { id: 'mp101', label: 'Mortgage Protection 101', product: 'mortgage', parts: [
      { title: 'What it is', format: 'didyouknow' }, { title: 'A common myth', format: 'myth' }, { title: 'If you’re a new homeowner', format: 'ifyoure' }, { title: 'Your next step', format: 'question' }] },
    { id: 'fam101', label: 'Protecting your family', product: 'family', parts: [
      { title: 'Why it matters', format: 'question' }, { title: 'A common myth', format: 'myth' }, { title: 'A mistake to avoid', format: 'mistake' }, { title: 'Your next step', format: 'question' }] },
  ],
  // What to film for Brand → Your own clips, in one sitting. Each shot is a few seconds, vertical, no
  // talking. `words`: a clip described with any of these counts as done. Never real client faces or papers.
  shotList: [
    { id: 'desk', shot: 'You at your desk, smiling at the camera', why: 'Opens and closes videos with a face people learn to trust.', words: ['desk', 'office', 'smiling', 'smile'] },
    { id: 'wave', shot: 'You waving or nodding at the camera', why: 'The best last scene for “Message me”.', words: ['wave', 'waving', 'nod', 'nodding', 'hello', 'hi'] },
    { id: 'phone', shot: 'You on the phone, listening and nodding', why: 'Shows what reaching out to you looks like.', words: ['phone', 'call', 'calling', 'listening'] },
    { id: 'notes', shot: 'Your hands writing in a notebook at a kitchen table', why: 'Fits planning and “here’s how it works” scenes. Use your own blank notebook, never real client papers.', words: ['hands', 'writing', 'notebook', 'notepad', 'kitchen', 'table'] },
    { id: 'coffee', shot: 'You with a cup of coffee by a window, thinking', why: 'Fits the quiet worry in an opening.', words: ['coffee', 'window', 'cup', 'thinking', 'tea'] },
    { id: 'door', shot: 'Walking up to a front door or porch (yours or a friend’s)', why: 'Fits “I come to you” and local videos.', words: ['walking', 'door', 'porch', 'front', 'walk'] },
    { id: 'drive', shot: 'Your town through the car window, filmed by a passenger', why: 'Local videos and “Here in your town” openings.', words: ['driving', 'car', 'drive', 'road'] },
    { id: 'town', shot: 'A landmark, sign or main street in your town', why: 'Grounds videos where your clients live.', words: ['town', 'street', 'landmark', 'sign', 'main', 'downtown', 'city'] },
    { id: 'family', shot: 'You with your own family outside (only people who agreed to be filmed)', why: 'Your own story videos.', words: ['family', 'kids', 'park', 'outside', 'outdoors', 'husband', 'wife', 'mom'] },
    { id: 'point', shot: 'You pointing up at the empty space above your head', why: 'Leaves room for a caption, great for “Things to know”.', words: ['pointing', 'point', 'up'] },
  ],
  // Starting values for a new workspace in this niche.
  defaults: {
    title: 'Licensed Agent',
    defaultQuestion: 'what fits your budget and your family',
    ttsStyle: 'Warm, friendly and unhurried, like talking with a neighbor at the kitchen table. Clear and easy to follow.',
  },
};
