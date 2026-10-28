// public/screens/guide.js — the Guide: how the app works, in plain words.
import { S, esc, main } from '../app.js';

async function viewGuide() {
  const admin = S.me.account.role === 'admin', ws = S.me.workspace;
  const tab = (k, label) => (ws?.onboarded ? `<a href="#/${k}">${label}</a>` : `<b>${label}</b>`);
  main.innerHTML = `<div class="head"><h1>Guide</h1><p class="lede">How ${esc(S.product)} works, in plain words. Five minutes to read; worth it.</p></div>
    <section class="panel"><h2>How it works</h2>
      <ol class="steps-list">
        <li><b>You set it up once.</b> Your name, what you sell, who you help, how you sound, and the facts your videos may teach. Only facts you confirm are ever used.</li>
        <li><b>The app writes and makes each video.</b> It picks one audience, one worry and one confirmed fact, writes several openings and drafts, checks every rule, finds footage, adds captions (and a voice if you want one) and your end card.</li>
        <li><b>You review.</b> Watch it with sound, tick the checklist, approve or reject. Rejecting with a reason teaches the next scripts.</li>
        <li><b>You post</b>, by hand or automatically to Instagram.</li>
        <li><b>You add results.</b> A few days later, add views and messages. Topics and openings that bring messages come up more often.</li>
      </ol></section>
    <section class="panel"><h2>A simple weekly routine</h2>
      <ul class="list">
        <li class="ok"><i>1</i><span><b>Monday, 5 minutes:</b> read the coach’s check-in on ${tab('today', 'Today')} and tap <em>Make these videos</em>.</span></li>
        <li class="ok"><i>2</i><span><b>Most mornings:</b> turn on <em>Overnight</em> in ${tab('create', 'Create')} so a few videos are waiting when you wake up.</span></li>
        <li class="ok"><i>3</i><span><b>Review in one sitting:</b> watch, approve or fix a scene. Approve a small batch at a time.</span></li>
        <li class="ok"><i>4</i><span><b>Post 3 to 5 times a week:</b> by hand, or set a posting plan in ${tab('autopilot', 'Setup → Autopilot')} so one approved video goes out each day.</span></li>
        <li class="ok"><i>5</i><span><b>Three days after posting:</b> add views and messages under Posted.</span></li>
      </ul></section>
    <section class="panel"><h2>Where everything is</h2>
      <p class="small muted" style="margin:0">Five stops for every day, and Setup for what you set once. Your account, this guide and billing are under your initial in the top corner.</p>
      <dl class="meta wide">
        <dt>Today</dt><dd>Where your day starts: what’s waiting, your list, the week ahead, what’s coming up, and the coach’s weekly check-in.</dd>
        <dt>Review</dt><dd>Watch, approve, reject or fix videos; post them; add results; download approval records.</dd>
        <dt>Create</dt><dd>Make videos now or pick the topic and format in Studio (and test two openings); overnight videos; test a script or footage.</dd>
        <dt>Leads</dt><dd>The people your videos bring in: leads and follow-ups, client care and keepsakes, handoffs with your assistant, and keyword replies on Instagram.</dd>
        <dt>Grow</dt><dd>What’s working and your opening tests; Communicate (the four communication styles and the input workshop); and Mindset (your why, habits and tools from ten books).</dd>
        <dt>Setup</dt><dd>Six steps, in the order a video is built: <b>Profile</b> (your name, end card, photo, booking link and who you serve), <b>Library</b> (audiences, worries, facts, solutions, your own clips), <b>Voice and rules</b>, <b>Look</b> (captions, footage, length and formats), <b>Autopilot</b> (Instagram, Facebook, the posting plan, going away) and <b>Team</b> (assistants and a compliance reviewer).</dd>
        <dt>Coach (✦)</dt><dd>Ask anything about your videos, or switch it to Communication. Its suggestions can be tried side by side and applied in one tap.</dd>
      </dl></section>
    <section class="panel"><h2>Getting better videos</h2>
      <ul class="list">
        <li class="ok"><i>✓</i><span><b>Confirm at least 4 facts</b>, each linked to a worry, so videos don’t repeat.</span></li>
        <li class="ok"><i>✓</i><span><b>Paste 2 or 3 things you wrote</b> in Setup → Voice and rules. It changes the wording more than any setting.</span></li>
        <li class="ok"><i>✓</i><span><b>Write worries in your clients’ words.</b> “I don’t want my kids paying for my funeral” beats “final expense planning”.</span></li>
        <li class="ok"><i>✓</i><span><b>Set a style for each audience</b> in Grow → Communicate, then run a worry through the input workshop.</span></li>
        <li class="ok"><i>✓</i><span><b>Change one thing at a time</b>, and use the coach’s <em>Try it first</em> to compare before and after.</span></li>
        <li class="ok"><i>✓</i><span><b>Judge by messages, not views.</b> A video with 300 views and 3 messages beat one with 5,000 and none.</span></li>
      </ul></section>
    <section class="panel rules"><h2><span class="dot"></span>Compliance checks, and your part</h2>
      <p class="small" style="margin:0">Every script and post is compliance-checked in code before you see it: no prices or percentages, no promises that someone will qualify, nothing that sounds government-backed, no client stories, no pressure or invented urgency, and facts keep words like “usually” or “may”. Only facts you confirmed are used, and every approval is recorded with a fingerprint of the exact file.</p>
      <p class="small" style="margin:0"><b>The checks catch risky wording; they don’t make a video compliant.</b> You’re still the licensed agent: watch every video before it’s posted, and you stay responsible for final approval and for following your carriers’ and your state’s advertising rules. Many carriers and states want to review ads first; the approval records help with that but don’t replace it.</p></section>
    <section class="panel faq"><h2>Common questions</h2>
      ${[['Why can’t I make a video?', 'Usually no fact is confirmed and linked to a worry, or a worry isn’t linked to an audience. Create shows exactly what’s missing and a link to fix it.'],
        ['How long does a video take?', 'About two minutes. Videos are made one at a time in the background, so you can close the page.'],
        ['Can I change one caption or clip?', 'Yes. Review → Fix a scene. It re-renders in a minute or two without writing a new script.'],
        ['Captions only, or voiceover?', 'Captions-only videos let you add a trending sound in Instagram, which helps reach. Voiceover videos carry the message for people who listen, and their post text says the voice is AI (you can turn that off in Setup → Voice and rules). Change it any time there.'],
        ['Does it post for me?', 'If Instagram is connected in Setup → Autopilot, yes: only videos you approved, at the time you pick or on your posting plan. Instagram can’t add a trending sound to automatic posts, so captions-only videos post without one.'],
        ['What does the coach know?', 'Your setup, your recent videos, why you rejected some, and which ones brought messages. It suggests; you decide.'],
        ['Who can see my workspace?', 'Only you, and your admin when they help you. Each agent’s videos and settings are separate.'],
        ['Can I use clips of myself?', 'Yes. Setup → Library → Your own clips: upload short clips from your phone, describe each in a few words, and choose how often they’re used. The rest is stock footage.'],
        ['Do some topics fit certain months?', 'Yes. Setup → Library → Worries → In season: tick the months, and those worries come up more often then. The tab suggests this month’s moment, like September’s Life Insurance Awareness Month.'],
        ['Can I refer another agent?', 'Yes, when billing is on. Billing has your referral link. When an agent you refer starts a paid plan, you get a month free.'],
        ['Can I get a copy of my data, or have it deleted?', 'Yes. Account → Your data downloads everything in one file. Request deletion there too: once it’s confirmed, your workspace, videos and records are deleted and you get an email.']].map(([q, a]) => `<details><summary>${esc(q)}</summary><p class="small" style="margin:0">${esc(a)}</p></details>`).join('')}</section>
    ${S.me.support ? `<section class="panel"><div class="row between"><div class="head"><h2>Still stuck?</h2><p>Email us and we’ll help.</p></div><a class="btn" href="mailto:${esc(S.me.support)}?subject=${encodeURIComponent(S.product + ' help')}">Email ${esc(S.me.support)}</a></div></section>` : ''}
    ${admin ? `<section class="panel out"><h2><span class="dot"></span>For you as the admin</h2>
      <ul class="list">
        <li class="ok"><i>1</i><span><b>Add an agent:</b> Admin → Invite. With email set up the invite is emailed; otherwise send them the link. Tick <em>No charge</em> for friends and testers. People who ask on your landing page (/welcome) show up under <em>Access requests</em> with an <em>Invite</em> button.</span></li>
        <li class="ok"><i>2</i><span><b>Help an agent:</b> Admin → Open puts you in their workspace. <em>Back to Admin</em> takes you out.</span></li>
        <li class="ok"><i>3</i><span><b>Done for you:</b> mark the workspace <em>Done for you</em>, open it, tune their content and styles, and log your time on their card so you can see what each client earns per hour.</span></li>
        <li class="ok"><i>4</i><span><b>Plans:</b> Solo and Done for you are the two Stripe plans (Starter and Pro in .env). Founding rates are Stripe promotion codes; checkout accepts them.</span></li>
        <li class="ok"><i>5</i><span><b>Alerts:</b> failed videos, failed payments, failed backups, low disk and Instagram problems show in Admin. Set ALERT_WEBHOOK_URL to get them on your phone.</span></li>
        <li class="ok"><i>6</i><span><b>Data deletion:</b> when an agent asks to be deleted, you get an alert and their card in Admin shows <em>Delete everything</em> or <em>Decline</em>. Cancel their Stripe subscription first.</span></li>
        <li class="ok"><i>7</i><span><b>AI cost cap:</b> each workspace has a monthly AI budget (AI_COST_CAP_USD, $20 unless you set it). You get an alert at 80%; at 100% its new videos, test scripts and coach pause until next month. Change one workspace’s cap with <em>AI cap</em> on its card.</span></li>
        <li class="ok"><i>8</i><span><b>Updates:</b> unzip the new version on the server and run <code>bash update.sh</code>. It runs the checks first and won’t restart a broken version.</span></li>
      </ul></section>` : ''}`;
}

export { viewGuide };
