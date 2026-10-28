// mindset-core.js — the Mindset tab's library and arithmetic, shared by the portal and the server.
// Each book is turned into a working tool, not a summary: a daily principle with a one-line
// challenge, and the tools in lib/mindset.js. Principles are short paraphrases of each book's idea
// in plain words (never quotes), written for an insurance agent's day.

export const BOOKS = {
  sinek_why: { title: 'Start With Why', author: 'Sinek' },
  sinek_game: { title: 'The Infinite Game', author: 'Sinek' },
  clear: { title: 'Atomic Habits', author: 'Clear' },
  carnegie: { title: 'How to Win Friends and Influence People', author: 'Carnegie' },
  cialdini: { title: 'Influence', author: 'Cialdini' },
  ferriss: { title: 'The 4-Hour Workweek', author: 'Ferriss' },
  greene: { title: 'Mastery', author: 'Greene' },
  collins: { title: 'Good to Great', author: 'Collins' },
  suntzu: { title: 'The Art of War', author: 'Sun Tzu' },
  grover: { title: 'Relentless', author: 'Grover' },
};

// One rotation of 30 (three per book, in turns), so ten days in a row never repeat a book.
const P = (id, book, text, challenge) => ({ id, book, text, challenge });
export const PRINCIPLES = [
  P('why1', 'sinek_why', 'People don’t buy what you sell; they buy why you sell it.', 'Tell one person today why you do this work, before you mention a product.'),
  P('game1', 'sinek_game', 'You’re not trying to win this month; you’re trying to still be serving these families in ten years.', 'Check in on one past client with nothing to sell.'),
  P('clear1', 'clear', 'You don’t rise to your goals; you fall to your systems.', 'Pick the one habit that would make tomorrow easier, and do it today.'),
  P('carn1', 'carnegie', 'A person’s own name, and their own story, matter more to them than anything you can say.', 'In your next conversation, ask one more question about their family than you normally would.'),
  P('cial1', 'cialdini', 'People feel a pull to give back when you give first.', 'Send one client something useful today, with no request attached.'),
  P('ferr1', 'ferriss', 'Being busy isn’t the same as being productive. A few activities bring most of your results.', 'List what you did yesterday. Circle the one thing that actually moved a client forward.'),
  P('greene1', 'greene', 'Mastery comes from long, patient practice of the basics, not from shortcuts.', 'Practice one objection out loud three times today.'),
  P('coll1', 'collins', 'Great comes from focusing on what you can be the best at, love, and get paid for.', 'Write down the one kind of client you serve better than anyone near you.'),
  P('sun1', 'suntzu', 'Know yourself and the ground you stand on, and you won’t fear the outcome.', 'Name one strength and one weakness you’ll lean on or fix this week.'),
  P('grov1', 'grover', 'Finish what others leave half done.', 'Close one loop you’ve been putting off: a callback, an application, a follow-up.'),
  P('why2', 'sinek_why', 'When your why is clear, the right people find you and stay.', 'Read your why before your first call today.'),
  P('game2', 'sinek_game', 'A worthy rival shows you where you can grow, not who you need to beat.', 'Look at one agent you admire and write down one thing they do better.'),
  P('clear2', 'clear', 'Every action is a vote for the person you want to become.', 'Do one small thing today that the agent you want to be would do.'),
  P('carn2', 'carnegie', 'Talk in terms of the other person’s interests.', 'Rewrite one message so it starts with what they care about, not what you offer.'),
  P('cial2', 'cialdini', 'People trust those they like, and they like people who are genuinely like them.', 'Share one honest, ordinary thing about yourself with a client today.'),
  P('ferr2', 'ferriss', 'What you can automate or hand off, you should, so your time goes to people.', 'Pick one task this week to automate, batch or delegate.'),
  P('greene2', 'greene', 'Find a mentor and absorb how they think, not just what they do.', 'Ask a more experienced agent one real question this week.'),
  P('coll2', 'collins', 'Face the hard facts about where you are, and never lose faith that you’ll get there.', 'Write down your honest numbers for last week, without excuses.'),
  P('sun2', 'suntzu', 'Win before the battle: prepare so well that the conversation goes your way.', 'Prepare your answer to the objection you dread most.'),
  P('grov2', 'grover', 'Pressure is a privilege; it means you’re doing something that matters.', 'Do the hardest call on your list first.'),
  P('why3', 'sinek_why', 'Say why, then how, then what. Most people say it backwards.', 'Start your next introduction with why you do this, not your title.'),
  P('game3', 'sinek_game', 'Keep serving clients long after the sale; that’s where trust compounds.', 'Send a birthday or anniversary note to one client this week.'),
  P('clear3', 'clear', 'Never miss twice. One slip is an accident; two is the start of a new habit.', 'If you missed a habit yesterday, do the smallest version of it now.'),
  P('carn3', 'carnegie', 'Let the other person feel the idea is theirs.', 'In your next conversation, ask a question that helps them reach the answer themselves.'),
  P('cial3', 'cialdini', 'Small, honest commitments lead to bigger ones.', 'End one conversation with a small next step they say yes to.'),
  P('ferr3', 'ferriss', 'Define your fears. Most of them are cheaper than the cost of doing nothing.', 'Write down what you’re avoiding and the worst realistic outcome.'),
  P('greene3', 'greene', 'Practice with intention: work on the part you’re weakest at, not the part you enjoy.', 'Spend ten minutes on the skill you avoid.'),
  P('coll3', 'collins', 'Momentum is built one push at a time, like turning a heavy flywheel.', 'Do one small thing today that keeps last week’s momentum going.'),
  P('sun3', 'suntzu', 'Adapt to the ground; what worked last month may not work this month.', 'Look at your last five videos and change one thing about the next.'),
  P('grov3', 'grover', 'Do the work when nobody’s watching, and results show up when everyone is.', 'Make your follow-ups today before anything else.'),
];

// The principle for a day: the rotation moves one a day; "Next principle" moves it one more for that day.
export function principleFor(date, offset = 0) {
  const day = Math.floor(Date.parse(`${String(date).slice(0, 10)}T12:00:00Z`) / 86400000);
  const n = PRINCIPLES.length;
  return PRINCIPLES[(((day + offset) % n) + n) % n];
}

// The skills of the mastery path (Greene), each with levels 1 to 5.
export const SKILLS = {
  prospecting: { label: 'Prospecting', tip: 'Finding and starting conversations with the right people.' },
  objections: { label: 'Objection handling', tip: 'Hearing the real worry behind a no, and answering it honestly.' },
  closing: { label: 'Closing', tip: 'Helping someone make a decision and take the next step.' },
  product: { label: 'Product knowledge', tip: 'Knowing your carriers’ products, underwriting and rules cold.' },
  market: { label: 'Market knowledge', tip: 'Knowing your town, your clients and what other agents offer.' },
  followup: { label: 'Follow-up and service', tip: 'Staying in touch long after the sale.' },
};
// Five practice sessions move a skill up a level (to 5).
export const PRACTICE_PER_LEVEL = 5;
export const skillLevel = (practiceCount = 0, start = 1) => Math.min(5, Math.max(1, start + Math.floor(practiceCount / PRACTICE_PER_LEVEL)));

// Honest persuasion (Cialdini) a script can use. Scarcity and urgency stay off: they read as pressure,
// and the platform rules already block fear and invented urgency.
export const PERSUASION = {
  reciprocity: { label: 'Reciprocity', how: 'The video gives real value first: something useful to know, nothing asked for in return.' },
  authority: { label: 'Authority', how: 'It rests on the agent’s true experience or the facts they confirmed, never on claims.' },
  liking: { label: 'Liking', how: 'It sounds like a real, warm person: the agent’s own voice.' },
  unity: { label: 'Unity', how: 'It speaks as one of them: the same town, “families like ours”.' },
  commitment: { label: 'Commitment', how: 'It asks for one small, easy next step.' },
  social: { label: 'Social proof', how: 'It notes that many people in their spot do this (general, never a client story or testimonial).' },
};
export const PRESSURE = ['scarcity', 'urgency'];

/* ---------------- Habits and the growth score ---------------- */
export const dayKey = (t = Date.now(), tz = 'America/Denver') => {
  try { return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(t)); }
  catch { return new Date(t).toISOString().slice(0, 10); }
};
const addDays = (key, n) => new Date(Date.parse(`${key}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
// The Monday of a day's week (YYYY-MM-DD).
export const weekOf = key => { const d = new Date(`${key}T12:00:00Z`); return addDays(key, -((d.getUTCDay() + 6) % 7)); };

// Days off (`off`: weekdays, 0 = Sunday) never break a streak and never count against anyone.
const wdOf = key => new Date(`${key}T12:00:00Z`).getUTCDay();
const prevWork = (key, off) => { let k = addDays(key, -1); for (let n = 0; n < 7 && off.includes(wdOf(k)); n++) k = addDays(k, -1); return k; };
// A daily habit's streak: working days in a row done, ending today (or the last working day, if today
// isn't done yet). A day off that was done anyway still counts.
export function streak(done = [], today, off = []) {
  const set = new Set(done);
  let k = set.has(today) ? today : addDays(today, -1), n = 0;
  for (let guard = 0; guard < 800; guard++) {
    if (set.has(k)) n++;
    else if (!off.includes(wdOf(k))) break;
    k = addDays(k, -1);
  }
  return n;
}
// "Never miss twice": missed the last working day, today isn't done yet, and the one before was done.
// Never on a day off.
export const missedOnce = (done = [], today, off = []) => {
  if (off.includes(wdOf(today)) || done.includes(today)) return false;
  const p1 = prevWork(today, off), p2 = prevWork(p1, off);
  return !done.includes(p1) && done.includes(p2);
};

// Habits that tick themselves from the work: approving or posting videos this week.
export const AUTO_HABITS = { post: { label: 'Post {n} reels this week', field: 'posted' }, approve: { label: 'Approve {n} videos this week', field: 'approved' } };
export function autoProgress(habit, videos = [], today, tz) {
  const week = weekOf(today), inWeek = at => at && weekOf(dayKey(Date.parse(at), tz)) === week;
  const n = habit.auto === 'post' ? videos.filter(v => inWeek(v.posted?.at)).length : habit.auto === 'approve' ? videos.filter(v => inWeek(v.approval?.at)).length : 0;
  return { n, target: habit.target || 3, done: n >= (habit.target || 3) };
}

// The growth score (0-100): habits kept over the last two weeks (40), skill levels (30), weekly
// reflections in the last four weeks (10) and messages from videos in the last 30 days (20).
// `asOf` lets the "+N this week" compare with a week ago.
export function growthScore(m = {}, videos = [], { today, tz, asOf = 0, off = [] } = {}) {
  const end = addDays(today, -asOf), days = Array.from({ length: 14 }, (_, k) => addDays(end, -k)).filter(d => !off.includes(wdOf(d)));
  const daily = (m.habits || []).filter(h => !h.auto);
  const kept = daily.length && days.length ? days.reduce((a, d) => a + daily.filter(h => (m.checks?.[h.id] || []).includes(d)).length, 0) / (daily.length * days.length) : 0;
  const lv = Object.keys(SKILLS).map(k => skillLevel((m.practice || []).filter(p => p.skill === k && dayKey(Date.parse(p.at), tz) <= end).length, m.skills?.[k] || 1));
  const skills = (lv.reduce((a, b) => a + b, 0) / lv.length - 1) / 4;
  const reflect = Math.min(1, (m.reflections || []).filter(r => r.week <= end && r.week > addDays(end, -28)).length / 4);
  const from = addDays(end, -29), dayOf = at => dayKey(Date.parse(at), tz);
  const msgs = videos.filter(v => v.status === 'posted' && v.posted?.at && dayOf(v.posted.at) <= end && dayOf(v.posted.at) >= from).reduce((a, v) => a + (v.results?.messages || 0), 0);
  const results = Math.min(1, msgs / 5);
  return Math.round(40 * kept + 30 * skills + 10 * reflect + 20 * results);
}
