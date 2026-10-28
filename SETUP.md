# Agent Reels 15 — setup and running

Agent Reels makes short, compliance-checked Instagram Reels for life insurance agents. Each agent has their own login and workspace. They set up once (their products, clients and voice), confirm each fact their videos may teach, then review, approve and post, by hand or automatically to Instagram. You run it from one server and manage agents, plans and alerts from the **Admin** tab.

```
/root/generator/
├── server.js        the site: logins, workspaces, queue, billing, Instagram, portal
├── admin.js         account tasks from the terminal
├── generate.js      make a video or test script from the terminal
├── pipeline.js      script → voice → footage → render → checks → review
├── mixer-core.js    the rules engine (portal and server share it)
├── niches/          what makes it about life insurance: products, compliance floor, wording (section V)
├── comms-core.js    the communication playbook: DISC styles, principles, selling (portal and AI share it)
├── templates.js     starter content: final expense, mortgage protection, family protection
├── lib/             storage, logins, billing, queue, overnight jobs, setup, coach, alerts, Instagram
├── stages/          each step of making a video
├── public/          the portal
├── test/            automatic checks (npm test)
├── update.sh        one-command update, with automatic rollback (section S)
├── setup-user.sh    run the app as its own user instead of root (section U)
├── data/            accounts, workspaces, settings, records (JSON files, or app.db with SQLite)   ← backed up nightly
├── videos/          finished videos, one folder per workspace
├── backups/         nightly copies of data/
├── fonts/           caption fonts (downloaded automatically)
└── music/           optional royalty-free tracks
```

No npm packages are needed. It needs Node 22+, FFmpeg, pm2 and nginx, which your server already has.

---

## What's new in 15

Version 15 is about the engine: the parts nobody sees, built so a fault stays small, gets noticed, and fixes itself where it can. Then polish, then new features. It arrives in phases; each phase is a complete, tested update (section A).

**Do this first, whatever version you're on.** OpenAI is removing every model this app used by default: its speech models (`gpt-4o-mini-tts`, `tts-1`) on **January 6, 2027**, `gpt-4o`, `gpt-4o-mini` and `gpt-4.1` on **January 14, 2027**, and `whisper-1` on **February 26, 2027**. Version 15 steps down to newer models by itself and warns you 90 days ahead of any shutdown, but voiceovers need a second voice company after January 6 (OpenAI named no replacement that works for plain speech). See section AK.

**Phase 1: the six critical fixes** (section AK)
- **A damaged data file is never saved over.** If a file can't be read (a hand edit gone wrong, a disk fault, a power cut at the wrong moment), it used to read as empty and the next save wrote over it. Now it's repaired from its previous save (every save keeps one) or the newest backup, the damaged copy is kept in `data/damaged/`, and you're alerted. With no good copy anywhere, nothing writes over it until you restore it.
- **A frozen FFmpeg can't stop every agent's videos.** Every outside program has a time limit, and a watchdog stops any video that stops making progress (`JOB_IDLE_MINUTES`, default 12) or runs too long (`JOB_MAX_MINUTES`, default 40), kills what it started and puts it back in line. You're told afterwards; nothing to restart.
- **Instagram never says "didn't go out" for a post that did, and never posts twice.** Each step is saved before it's taken. When Instagram's answer is lost, the next minute asks Instagram what happened. If it can't be told for half an hour, the video is marked **We couldn't confirm** and the agent is asked to check; posting it again checks Instagram first.
- **The backup before an update is safe and checked.** It uses the same safe database copy as the nightly backup and is unpacked to check it; if it can't be made, `update.sh` stops and changes nothing.
- **Backup AI models.** Each AI job has a ladder: your `.env` model first, then backups (OpenAI's recommended replacement, then Claude and ElevenLabs when their keys are set). A retired model steps down at once; an outage or an empty account moves to another company; a setting a new model refuses is dropped. A daily check reads each company's shutdown dates. `node admin.js models` shows it all.
- **A retry picks up where it stopped.** Each finished stage of a video (script, voice, footage, render) is kept between tries, so a failure late in a video, or a wait for an outage, no longer pays for a new script and voice and makes a different video.

**Phase 2: data that can't be lost, and the video line** (sections T and AL)
- **Saves survive a power cut.** Every saved document is forced onto the disk (the file, then its folder) before the app moves on; the database waits for the disk on every save (`synchronous=FULL`).
- **The database is the standard.** New installs start on SQLite. An update moves a server still on JSON files into the database once, with the app stopped, checking every document (the JSON files are kept). `STAY_ON_JSON=1` opts out.
- **A nightly inspection.** Every document is read (a damaged one is repaired then, not when an agent opens it), the database checks itself, and the links between records and files are checked. Safe fixes are made automatically; anything that needs you comes as one alert. `node admin.js inspect` runs it now.
- **Every record has a declared shape**, checked when it's saved. Fields a newer version added are always kept, so going back a version never strips them.
- **A disk reserve.** Below 1.5 GB free (`DISK_RESERVE_GB`), no new video starts: the space left is kept for logins, settings and approvals. Caches are cleared at once and you're alerted. Videos wait in line and start again by themselves.
- **Clean restarts.** On an update or restart, a video being made goes back in line without using up its try, its FFmpeg is stopped, and it resumes from its last finished step.
- **Leases.** A video is taken from the line on a lease that's renewed while it runs. A worker that dies loses it, and the video goes back in line by itself; two workers can never make the same video.
- **Rendering apart from the website (optional).** `worker.js` makes videos in a process of its own, so a crash there never takes the site down, and more workers can be added (section AL).
- **Night capacity.** Each night the app works out whether everyone's overnight videos fit between 1 and 6am at today's speed, and warns you before they don't.

**Phase 3: running on one bank, and no double anything** (section AM)
- **A breaker for each outside service.** That covers OpenAI, Claude, ElevenLabs, Pixabay, Pexels, Instagram, Facebook, Stripe, email and push. When one keeps failing (5 in a row), its breaker opens: nothing calls it for a minute, then one trial call (longer each time, up to 15 minutes). You're told when it opens and when it's back.
- **Limp modes.** While a service is down, the app runs on what's left:
  - **Writing:** another AI company.
  - **Footage:** Pexels alone when Pixabay is down.
  - **Posts:** they wait, then go by themselves. Instagram or Facebook being down no longer uses up a post's tries.
  - **After 20 minutes of waiting:** a video is made anyway, with captions only if the voice service is still down (and without the post's AI voice note, since there's no voice), or with the agent's own clips if both stock sites are. Its review card says so. Each stage keeps its own count, so a writing outage never sends the voice to captions early.
- **Agents see one plain line**, under the tabs, for anything paused or down that affects them ("Instagram isn't answering right now. Scheduled posts go out by themselves when it's back.").
- **The switchboard in Admin.** Turn off making videos, overnight videos, posting, the coach, emails or notifications, for everyone or for one workspace, with a note saying why. Everything else keeps running.
- **The outbox.** Emails and notifications go through one saved outbox. They're sent at once if possible; otherwise kept and sent again (1, 5, 30 minutes, 2 and 6 hours), with a one-time key so the same message never goes twice. Emails switched off are held up to 3 days. Admin shows what's waiting, sent, refused and given up.
- **One-time keys on every change.** The portal sends a key with every change. A double tap, or a resend over a weak signal, is done once, and the second gets the first's answer. Stripe gets a one-time key on every change too, and one whose answer was lost is sent again with the same key.

**Phase 4: the dyno, and the gauges** (section AN)
- **The Engine bay** (Admin). One page for how the engine is running: the line and how long each step takes, each outside service and how often it answered today, memory and lag of the website and any worker, free disk with its trend ("full in about 40 days"), backups, the reference render, Node and FFmpeg versions, the clock, and the last runs with each one's full timeline on a tap. `node admin.js engine` shows the same in the terminal.
- **A flight recorder.** Every video keeps a timeline of its steps and every service it called (which AI model, the stock sites, FFmpeg), with how long each took and whether it worked. "Why did this one take 20 minutes?" now has an answer.
- **Targets with warning lights.** Overnight videos ready by 7am (their time) 99% of the time; no double posts; videos made without failing 98%; 95% of videos within 15 minutes; backups under 26 hours old; no message that gave up; 60 days of disk; the clock within 2 seconds; the website answering without lag. Green, yellow or red in the Engine bay; a red light sends an alert (repeated weekly while it stays red).
- **Alerts written like a service manual.** Every warning and error now says what happened, what the app already did about it, and the one thing left for you (often a command to paste). An alert that can't be saved (a full disk) still reaches your phone, once, not on every repeat.
- **A clock check.** Once a day the server's clock is compared with an outside source. Two-factor codes, Stripe's webhooks and phone notifications all fail quietly when it drifts; now you're told, with the fix.
- **A nightly reference render.** The same test video is rendered every night with the real FFmpeg and fonts and compared with the first one. An operating-system update that changes FFmpeg shows up the next morning, not in agents' videos.
- **A full disk is answered plainly.** A save refused for lack of space changes nothing, the agent sees "out of disk space, nothing was changed", and you're alerted.
- **Found and fixed by the new checks:**
  - "The next few days" (the posting plan running low, the next Monday plan) could skip a day around midnight when the clocks change. Days now step by the calendar.
  - The nightly cleanup rewrote a workspace's whole video list once per removed video: with years of videos, 40 seconds for 8 agents. It's one save per workspace now (half a second).
  - A scene fix cut off at the wrong moment could leave its record pointing at a removed file, or be applied twice when it ran again. The new version is saved before the old file goes, and a fix that already saved isn't done again.
  - Facebook could be asked to publish the same video twice if the app was cut off right after asking. It now asks Facebook where it got to first.
  - Approval records saved by very old versions (without a checklist) broke the records download.
- **The test rig** (for whoever changes the code; nothing to set up on a server):
  - **Crash tests** kill the app at every step of making, fixing and posting a video, restart it, and check nothing was lost or done twice.
  - **Fault injection**: every service slow, down, cut off or talking nonsense; a full disk; a damaged file; a frozen FFmpeg.
  - **A time machine**: every agent time zone through the days the clocks change, month and year ends and a leap day, for the posting plan, days off, quiet hours and the overnight top-up.
  - **A five-year soak**: five years of made-up data for 50 agents, with a time budget for every screen and nightly job.
  - **A coverage floor**: `npm run test:coverage` measures how much of the code the checks exercise; the number can only go up.

**Phase 5: built for 300,000 miles** (section AO)
- **An expiry calendar.** Everything the app depends on that runs out on a date, in one list with warnings 90, 30 and 7 days ahead: Node.js (22 ends April 30, 2027), Meta's API version (v25.0 ends July 29, 2028), AI models, Instagram connections that aren't renewing, agents' cards, and your HTTPS certificate.
- **A yearly archive.** Finished videos over a year old move into a file per year, so every screen and posting check reads the same small list however many years an agent has been here. Records, receipts, the data download and old links still find them.
- **Versioned keys.** Each sealed secret names its key, so the key can be changed (`node admin.js rotate-key`) without losing anything. A server restored without its `.app-key` now says so plainly at start.
- **Fonts ship with the app,** each checked against its checksum; music tracks are checked too.
- **Numbered data changes,** each run once, recorded, and tried on a copy first (version 15 itself needs none).
- **The portal refreshes itself after an update,** at a calm moment, keeping what was being typed.
- **A build sheet in every release,** checked by `update.sh` before anything changes.
- **Try-out on a copy, and side-by-side releases.** Every update starts the new version on a copy of your data first. Optionally (`bash update.sh --use-releases`, once), each version lives in its own folder and going back is instant (`bash update.sh --rollback`).
- **Standard mounts** for platforms, footage sources and niches, each with a test kit; and the two biggest files split by area (`routes/`, `public/screens/`).

**Phase 6: the videos finished like a craftsman's, and a portal that never jumps** (section AP)
- **Sound finished for Instagram.** Each spoken line gets soft edges (no clicks at the cuts) and the low rumble taken out; the music fades in and out gently and dips under the voice. The mix is measured, then turned to Instagram's loudness (-14 LUFS) in one exact step, with any peak caught under -1.5 dBTP. No more pumping from a one-pass leveler.
- **Instagram's safe zones, every frame.** Every frame of the captions and the end card is checked against the parts of the screen Instagram covers (the like, comment and share buttons; the name, post text and audio line; the header). A caption that strays in is made a little smaller and checked again; long names on the end card are sized to fit. The review card says so.
- **Caption craft.** Real apostrophes and quotes (it’s, “someday”). Lines break where they read well: never "Social / Security", "Final / expense", "10 / years", or a line ending on "the" or "your", and no thin middle line. A stronger shadow when the footage behind the caption is bright.
- **Footage that matches.** Each clip is nudged toward the others' brightness and color, so stock from different shoots looks like one. Cuts move to the music's beat (a little, never cutting a spoken line short).
- **A designed first frame, and a clean loop.** A scene starts past its clip's fade-in from black, so the first frame (the one Instagram shows before anyone taps) is picture with the hook on it. The last moment cross-fades back to that first frame, so when Instagram loops the Reel there's no jump.
- **A second craftsman's look.** After the render, a frame from the middle of every scene, caption and all, is looked at once more for a business sign in the background (a competitor's, perhaps), a watermark, text in the footage fighting the caption, or a face whose mood fights the line. Anything found is named on the review card with its scene.
- **Preloading.** While the agent watches a video, the next one waiting is fetched ahead, so it plays the moment it's opened. A "your video is ready" notification fetches that video as it arrives, and tapping it opens that exact video, already loaded, without reloading the page.
- **No jumping.** Screens appear in their final shape: the morning greeting arrives with the page, never dropped in above it afterwards. The portal is compressed for the trip and never downloaded twice (the server only confirms it's current). The tests hold every screen to a speed budget and to no movement after it appears, on a phone-speed connection.
- **Undo instead of "Are you sure?"** Deleting or rejecting a video, deleting a Studio draft, a client or one of your own clips: it goes at once, with Undo for 10 seconds. Nothing is sent until then (or straight away if the page is hidden or closed, so a decision is never lost).

**Phase 7: Studio warns, doesn't block** (section AQ)
- **Three kinds of check, everywhere.** Every check in Studio, Fix a scene, ✦ Ideas and the coach is one of three kinds. **Stops** are the compliance rules (prices and price comparisons, rate and urgency talk, numbers the facts don't have, "you'll qualify", government wording, absolute claims, a dropped "usually", banned phrases, unconfirmed facts): a draft can't render with one, and each comes with a one-tap fix ("Take out “$30”", "Put “usually” back", "Say “see if you qualify”") or "Rewrite this line for me". **Notes** are style and craft (overused ad wording, word limits, where questions go, the highlighted word, spelling): shown, never blocking, and listed again on the review card. **Fixed for you** is what the app just does (a highlighted word not in the caption, a missing footage search), and it says so.
- **Admin → Render rules.** Change how strict each style rule is (block, warn or off) separately for drafts people write and for automatic videos; adjust the numbers (how much of the fact a teaching scene must say, word limits, how many recent videos count for "too close"); add or take off words in the built-in lists. For everyone, or one workspace. Try a change on a pasted script or a recent video before saving; every change is kept with who and when, and any earlier version is one tap back. The compliance rules can't be loosened.
- **A spelling check** on captions (about 79,000 American English words, plus insurance terms like "preneed"), shown on the scene's card with a one-tap correction, and the mix-ups a dictionary can't catch ("its a plan"). Names and the agent's own words are left alone, and so is good copy that only looks like a mix-up ("their will", "your right to choose").
- **Videos that teach no specific fact.** A Studio draft can be about a worry with no fact attached; then no fact checks apply, and every number is held back.
- **Open drafting, agent review.** An assistant's **Submit for review** puts the draft in the agent's Review ("Waiting for you"); the draft stays editable. The agent can tap **Needs changes**, tick what needs work in each scene (caption, spoken line, highlighted word, footage) and the music, and add a note. It goes to the assistant's Desk as a checklist they tick off in Studio. The next submit is a new version of the same video, marked **Updated**, showing what changed, and doesn't use up one of the month's videos. Only the agent approves; the receipt records the locked checks, the notes rendered past, and every version with who changed what.
- **Fix a scene: pick the clip.** "Show clips" brings about ten clips for the scene's footage search, each scored by the clip check (unusable ones left out), never one the video already uses, with a preview. Tap one to use it exactly; Refresh brings ten more (five times per search). A refused fix shows why, with the same one-tap fixes.
- **A sharper persuasion lens.** Every flag quotes the exact words that set it off (urgency, scarcity, a testimonial, fear or guilt); naming a real worry is a gentle note, not pressure. It says what the draft does well, and its advice and sample lines follow the same rules as scripts.
- **The coach never comes back empty-handed.** Lines it suggests for Studio that would stop a render are written again once, told why; what it says matches what's shown, with **Use** and **Use all** (the lines are checked together, so Use all never builds a board that can't render; a line that only works on its own says so).
- **Studio fixes:** the audience keeps its worry, a series explains its format, the top three openings first, the call to action named whole, the first-video note shown once, and the save bar stays above the phone's keyboard.
- **Numbers and price words are checked in every video.** "Coverage after 65" or "a few dollars a month" used to be caught only in Studio; now automatic videos and Fix a scene stop them too (the agent's own story and call to action may have numbers). Affordability claims with no amount ("costs less than you think", "just pennies", "the same as lunch") are price claims too.
- **Approving names the version watched.** If a new version arrived since the card was opened, or one is being made, approving waits until it's watched; Review shows the new version as soon as it's ready. A draft can be resubmitted up to 10 times per video.
- **Found and fixed:** a one-tap fix that would have left a line hanging ("Plans can cost", "plans for are") now offers a rewrite instead; a dropped "usually" goes back into the scene that says the words around it in the fact; a new version is no longer "too close" to the version it replaces.

**Phase 8: the app fits the agent** (section AR)
- **Videos ready when the agent usually reviews.** The app learns when the agent tends to review (from the last 60 days) and has the morning's videos ready about 45 minutes before; until it knows, it makes them overnight as before. Create says when they'll be ready.
- **Away.** Settings → Away: pick the day you're back. The app fills the days you're gone from the week's plan (or what's already scheduled), schedules them, tells the assistants on the Desk, and stays quiet (no reminders, no pushes to the agent). Back home, a welcome card shows what went out and what came in.
- **A busy week.** One tap makes up to 5 videos at once for the week ahead and sends one notification when they're all ready, opening them one by one.
- **Coming up** on Review: Instagram's connection running out, a card expiring, facts due for a check, weeks ahead. And in the morning, what the app did overnight.
- **A page behind every tracking link.** Viewers see the video's opening line, the agent's photo, name and town, a **Pick a time** button and one short form. A sent form is a new lead on the Desk, tied to the video that brought it, and the agent's phone hears about it. Brand → Your video pages: add a photo, or send people straight to the booking page as before.
- **Keepsakes.** From a client's card on the Desk: a short birthday video with their first name, or a welcome video for a new client made from the agent's own clips, to text them. Never posted; removed after 60 days.
- **Notes in the agent's voice.** A thank-you after booking, a welcome, a birthday, an anniversary or a check-in: three short drafts to copy. The Desk now reminds the agent to thank new bookings and welcome new clients.
- **Comfort.** Account → Comfort: bigger text and stronger contrast, and a theme that follows the phone, follows sunset where the agent is, or stays light or dark. Less motion when the phone asks for it.
- **The privacy curtain.** The eye at the top hides client names and notes, for working in a café or sharing a screen.
- **Times said the way people say them** ("this morning at 9:05am", "yesterday at 4pm", "last Tuesday"), in the agent's own time zone.
- **Milestones.** A card on the anniversary of the agent's first year (with the year's numbers), and at the end of each day, what the day added up to.
- **A simpler Studio start.** "What's this video about?" shows the agent's worries; tap one and the audience, fact and format follow (formats take turns). **Surprise me** picks one at random and writes the openings. Series show where they're up to, with **Continue**. The full panel is one tap away.
- **The save bar knows where it is.** On Account, Guide or Review, changes still waiting from Content, Brand or Settings say where they are, with **Go back to them**; a coach suggestion that's applied is saved at once.
- **Plans start at 30 and 60 videos** a month (Starter and Pro), still changeable per workspace.
- **No squeaks.** Typing, toggles and redraws never move the page or the cursor; the box being typed in stays clear of the phone's keyboard on every screen; the Coach button, ready cards and messages sit above the save bar even when it wraps to two lines; one ready card per video.

**Phase 9: new features — a reviewer, bookings, keyword replies and opening tests** (section AS)
- **A compliance reviewer, if the agent needs one.** People → Compliance reviewer: invite the person (often at the carrier or marketing organization) who signs off ads. They get their own login with only a Sign-off page, take no assistant seat, and use two-factor login. With **sign-off before posting** on, every approved video waits for them: Instagram, Facebook and the posting plan hold it, and it can't be downloaded or marked posted. They watch it, read the script, post text and checks, and sign it off or send it back to the agent's Review with a note. A fixed scene or new version needs signing off again. Each decision is on the compliance receipt and in the records file.
- **Bookings traced to the video that brought them.** The booking link now carries each video's code. Give the booking tool (Calendly, Cal.com, or Zapier/Make) the private address in Booking confirmations (Setup → Profile → Your video pages since Phase 10), and each booking moves the person to "Appointment booked" in Leads (or adds them), tied to the video, and counts in its results: a booking counts like three messages in what the app learns works. A canceled booking is noted. Moving a lead from a video to "Appointment booked" by hand counts too. Posted videos show their visits, leads and bookings.
- **Keyword replies on Instagram.** Keyword replies (on Leads since Phase 10): "Comment PLAN and I'll send it to you." When someone comments or messages the word, they get the agent's reply in a private message, right away, with {name} and {link} (the video's page, or the booking link) filled in. Replies are held to the same rules as any reply to a client, and the agent approves each one (an assistant can draft). Each comment gets one reply, each person hears from a keyword once a day, and at most 100 go out a day. The person shows up on the Desk as a new lead, tied to the video. Needs your Meta app set up for messages (section AS).
- **A/B tests of openings.** Studio → Check and submit → **Test two openings**: the video is made twice, the same but for the opening. Post both a day or two apart; a week after both are posted, the one with clearly more views wins (at least 20% more, and 100 views). Review shows each test and which kinds of opening (a question, a story, a number…) have won. The winner, and the opening it beat, are shown to the script writer from then on.

**Phase 10: one path through the day, and one place to set things up** (section AT)
- **Five daily stops.** The top bar is now **Today**, **Review**, **Create**, **Leads** and **Grow**, plus **Setup**. On a phone all six fit across the screen.
- **Today**, where the day starts: what's waiting in Review, what's ready to post, who to follow up with and how many videos are left this month, then the day's list, the week ahead, what's coming up, the coach's weekly check-in, the month's recap, and the nudge when videos keep missing. These used to sit at the top of Review, which is now just the videos.
- **Leads** is the Desk, with the keyword replies.
- **Grow** has three tabs:
  - **Results**: what's working, the opening tests, and why videos were rejected;
  - **Communicate**;
  - **Mindset**.
- **Setup is one guided path,** in the order a video is built:
  1. **Profile**: your end card, your video pages and photo, and who you serve.
  2. **Library**: audiences, worries, facts, solutions, the call to action, and your own clips.
  3. **Voice and rules**: voice, your own words and stories, rules, and what the app remembers.
  4. **Look**: captions and footage, video length and formats, and saved versions.
  5. **Autopilot**: Instagram, Facebook, the posting plan, and going away.
  6. **Team**: assistants and the compliance reviewer, or your done-for-you team.

  Each step shows only what that person can change, with a "Next" button to the following step.
- **The daily chain.** Each daily stop ends with the way to the next one, in the order a day goes: Today → Review → Create → Leads → Grow.
- **Account, Guide and Billing** are under the initial in the top corner, with Log out.
- **Where people land.** The agent lands on Today, an assistant on Leads, a reviewer on Sign-off.
- **Nothing was taken away.** Every control is where its step is, and works as before. Older links (`#/desk`, `#/content`, `#/brand`, `#/settings`, a notification from before) still open. The app's own wording now names the new places, and the Guide has the new map.

---

## What's new in 14

Version 14 makes the everyday work smoother: a Studio that helps at every card, footage that varies, a Content tab that links itself, a Mindset tab, and many quiet details. It arrives in phases; each phase is a complete, tested update (section A).

**Phase 1: Studio and footage** (sections AA and AD)
- **Write the rest from your opening.** Once an opening is chosen, a **Use this opening and write the rest** button sits right under it. A greyed-out button says why, and if the writer can't produce scenes that pass the checks, the reason stays on the page with **Try again**.
- **✦ Ideas on every scene card** (replaces Rewrite). One tap gives five versions of the line, each already checked against the Studio rules (keep the fact's key words and qualifier, no new numbers), plus how many were hidden and why ("2 hidden: one dropped “usually”, one added a number"). It also suggests footage searches (tap to search) and things to film yourself (tap to keep as a note on the card).
- **The coach works on the Studio draft.** In Studio the coach sees the board as it is on screen, saved or not, and its checks. Its suggestions go straight onto the board: a scene, a whole rewrite (take all or scene by scene), an opening, a footage search, a filming idea, a confirmed fact to teach, or a new fact for the worry (always unconfirmed until you confirm it in Content with a source). Its starter questions are Studio ones ("What’s stopping this from rendering?").
- **Footage searches you type are yours.** In Studio and Fix a scene, a search no longer has to name a person, can be longer than four words, and isn't held to the abstract-word list.
- **A shot plan for every automatic video.** Each scene gets a kind of shot before the script is written: people, close-up, action, slow motion, wide, still life, soft focus, golden hour, overhead or aerial. The opening and the call to action show a person; no kind repeats back to back or more than twice; people appear in at least half the scenes; and the rhythm changes from video to video. The AI clip check scores whether a clip is the right kind of shot, and stops asking for a person in shots that aren't about people. **Settings → Video → Footage mix** leans it toward more people or more scenery, and individual kinds of shots can be turned off.

**Phase 2: a smarter Content tab** (section AE)
- **New items link themselves.** Add a fact, worry, audience or solution and it's linked in every direction it clearly fits (a fact to its worries and solution, a worry to its audiences and facts…), shown as "✦ Linked automatically" with **Undo**. Any unlinked item has **✦ Link it for me**.
- **Every link is checked.** After each save, new links (and links whose words changed) get a fit check with a one-line reason. Links that fit show ✓, loose ones ⚠ (still used, worth a look), and mismatches ⛔ (left out of videos until fixed). A fact or solution tagged for one product line linked to one for another is a mismatch without any AI. **Use it anyway…** overrides a mismatch with a reason, which is kept in the activity log. **Check links** runs it by hand.
- **✦ Link everything** looks at the whole tab and proposes the links that are clearly missing, each with a tick box and a reason.
- **✦ Generate** on Facts (for a worry), Worries (for an audience), Audiences, Solutions (for a fact) and Call to action (for an audience): three options written from what they'd link to, each checked against the rules. Generated facts arrive unconfirmed and marked as AI suggestions: check them, add a source, then confirm.
- **Routes** shows each worry's whole chain (audience → worry → facts → solution → call to action) with a badge: Ready, Check (a loose link, no solution, a fact due for review) or Not used (and why).

**Phase 3: the Mindset tab** (section AF)
- **A tab for working on yourself**, the way you work your pipeline: a **growth score** (habits, skills, reflection and results together, with this week's change), **My why** (why → how → what, optionally shown before you reply to a message), **Today's principle** (one idea a day from ten books, with a one-line challenge; *I did it* or *Next principle*), and **daily habits** with an identity line, streaks and a "never miss twice" nudge. "Post 3 reels this week" and "Approve videos this week" habits tick themselves from your work.
- **A toolkit, one tool per book:** Relationship notes (Carnegie: a client list with family, interests and wins, and who to reach out to today; pick a client in the coach's Reply to a message and the reply knows them), the Persuasion lens (Cialdini: which honest principles a draft uses, with an honesty check; scarcity and urgency stay off), the 80/20 time audit (Ferriss: log the week, see what closes business, get advice on what to cut, automate or delegate), the Mastery path (Greene: skill levels from a practice log, and a mentor), the Hedgehog finder (Collins), the Strategy board (Sun Tzu: strengths, weaknesses, competitors, market shifts and an objection bank), Closer check (Grover: hardest task first) and Worthy rival (Sinek). A **weekly reflection** every Friday, with past weeks.
- **Mindset shapes Create** (the agent never sees the book names there): the hedgehog's products and audiences come up about half again as often; objections marked as video topics open "Question I get asked" videos (the agent's own answer is never used); when three of the last five videos asked for a conversation, the next leans toward giving; with a why saved, one opening each time comes from it and it shapes the tone of the bridge and call to action; real client questions and objections guide openings; each finished video is tagged with the honest principles it uses ("Uses: Reciprocity, Authority" in Review) and the persuasion lens flags any pressure in the pre-flight checks. The reflection shows which principles your posted videos used and the messages they brought.

**Phase 4: polish, part one** (section AG)
- **Quiet upkeep ("headlight washers").** Things that keep themselves clean without anyone asking: worries that fit this month's calendar moment (Mother's Day, Thanksgiving…) come up more on their own, untagged; and formats you keep approving come up more while ones you keep rejecting come up less.
- **Memory.** Reject a video as **Wrong music** and that track is never used for you again; reject it as **Weak opening** and new openings steer clear of it. Reopening the video takes the lesson back, and **Settings → What the app remembers** shows what's been learned with **Forget**.
- **Week ahead.** Review shows the next seven days of your posting plan, what each day already has (scheduled, ready, still in review) and "You're set through Friday." Gaps get one button: **Make 3 for the week**. Without a posting plan, it counts toward your weekly posting goal from Mindset.
- **Preview your grid.** How your Instagram profile will look once the ready videos go out, cropped to 3:4 like the real grid.
- **A greeting on open**, once a day: your name, what's waiting, how far ahead you're set, and your why.
- **Never lose an edit.** Content, Brand and Settings have **Undo** (and Ctrl/⌘+Z outside a text box). Unsaved changes are kept in the browser as you go; if the tab closes or the phone dies, they're offered back the next time.
- **Honest progress.** A video being made says which step it's really on (Step 2 of 4: Finding footage…), how long it's been, how long yours usually take, and when it's going again after a problem. Pages say what they're loading.
- **"Your video is ready"**, wherever you are in the app: a card with its cover and opening line. Turn on **Account → Notifications** to get it on your phone or computer with the app closed (never 9pm–7am, and not for overnight videos).
- **Milestones**: first video, first post, first message from a video, 10/25/50/100 posted. Each shows once.

**Phase 5: polish, part two** (section AH)
- **Opening the app:** the greeting puts good news first (a video that brought messages, booking-link clicks, the posting goal met), then what's waiting, then **today's principle** and your why. Back after ten quiet days, it says "No catching up needed" and offers one small step. At 80% of the month's videos or AI budget it gives a heads-up before anything stops.
- **Days off** (Settings → Profile): no notifications, nudges or review emails on those days, habit streaks don't break, and the greeting just says it's your day off. The posting plan still posts what you approved.
- **Your voice:** a **pronunciation** list for the AI voice ("Gallup" → "GAL-up"; captions keep the real spelling), **Words I never use** in Brand → Voice (with common ones to add in a tap), and rejecting a video as **Not my voice** can name the word to ban.
- **Brand:** **colors from your logo** offered as the highlight color (lightened when needed so it reads on video), and every uploaded clip gets plain checks (sideways, dark, too short, low resolution).
- **Filming yourself:** **Read it on camera** opens a teleprompter for any script (Studio or Review): adjustable speed and size, mirror mode, and the screen stays on.
- **Reviewing:** **Review one by one** shows one video at a time (swipe or ←/→, 1–9 to tick the checklist, Enter to approve, R to reject, a small vibration on phones); **Choose the cover** from six frames; the post text shows what appears **before "…more"** in the feed; every approved video has a printable **compliance receipt**.
- **Results:** posted videos show how they did next to your own average ("2.1× your average views") with **Make another on this**; a video that brought a message has **Draft a reply**, which opens the coach's Reply tab already knowing the video. The first week of each month shows **your month in review**.
- **When something goes wrong:** three rejections in a row ask **what's off** and lead to the one place that fixes it. If the server can't be reached, a calm banner says so and everything on screen stays; reads retry by themselves. Videos that hit an OpenAI or footage-site outage **wait and go again** (every 10 minutes, up to an hour) instead of failing, and say so. A failed video has **Make it again** (it didn't count toward the month). Technical error text is never shown to agents.
- **Offline review:** **Save for offline** keeps the videos waiting for review on the device; approvals and rejections made with no connection are sent when it's back.
- **Account:** devices read plainly ("Chrome on iPhone, active 2 hours ago"), and each data download leaves a **receipt** (shown in Account and emailed).
- **Every screen handles every state:** first use, loading (saying what's loading), partly loaded, failed (with **Try again**), and can't-do-now (buttons that need the AI or a video from the month's allowance turn off with the reason, instead of failing on tap).

**Phase 6: roles and portals** (section AI)
- **Capabilities.** Every page and every action now checks what the person may do in that workspace: approve, post, make videos, change settings, use the coach, reply, client notes, results, Mindset, billing, people, data, connect accounts, and (done for you) ask for changes. The server refuses anything else with a plain reason, and the portal shows only what each person can use.
- **Memberships.** One login can belong to more than one workspace (an assistant helping two agents), with a role in each. A workspace switcher appears in the header when there's more than one.
- **Solo and managed workspaces get their own portal.** A solo agent sees everything, as before. In a done-for-you workspace the team runs content, brand and settings, so the agent's portal has Review, Create, Communicate, Mindset, Brand (just their Instagram and Facebook) and **Your team**: what the team runs for them, and **Ask for a change**. The coach's suggestions there become "Ask my team for this".
- **The owner portal (Admin)** gets **Change requests** from done-for-you clients, oldest first: reply and mark done, and the agent is told (in the app and by notification). Members show their role.

**Phase 7: the Assistant Desk** (section AJ)
- **Assistant seats, a paid add-on.** Agents add seats in **People** (one per assistant, charged on their plan and prorated), or you give seats in Admin. An invite holds a seat until it's accepted or taken back; removing an assistant frees it.
- **What an assistant can do:** prepare and fix videos (Create, Studio, Fix a scene), use the coach, draft replies, keep leads, follow-ups and client care. They never approve or reject videos, never see the agent's Mindset, billing or data, and **log in with two-factor**. They **post only if the agent allows it** (Can post for me, per assistant). One person can assist several agents and switch between them.
- **The Desk** (agent and assistant): **Today** (what needs doing now: videos to approve or waiting on the agent, handoffs, follow-ups due, client care, results to add), **Handoffs** (an assistant drafts a reply in the coach and taps Hand to the agent; the agent copies it, sends it and marks it done; videos to watch and leads to call too, with a notification), **Leads and follow-ups** (new lead → talking → booked → client, with the next follow-up date and where they came from), and **Client care** (birthdays, policy anniversaries and anyone quiet for six months, with Draft a note).
- **Activity** (People): who did what in the workspace, so the agent sees their assistant's work at a glance.

## What's new in 13

Version 13 is about the videos themselves: better writing, voice and footage, a hands-on Studio, and tools that come to the agent instead of waiting. It arrives in phases; each phase is a complete, tested update (section A).

**Phase 1: writing quality** (section X)
- **A model for each job.** Scripts, openings and the critic can each use their own OpenAI model (`OPENAI_MODEL`, `OPENAI_HOOK_MODEL`, `OPENAI_CRITIC_MODEL`). A different model judging the drafts is more honest than one grading its own work. Unset, everything uses `OPENAI_MODEL` as before.
- **Replies that can't come back broken.** Every script, opening, critic and post call now tells OpenAI the exact reply shape it needs (structured outputs), so fewer drafts are wasted on malformed replies. A model that doesn't support it falls back to the old JSON mode by itself.
- **Structures.** Videos used to share one skeleton. Now five structures rotate: Classic, Answer first, Objection, Recap and Straight to you (no question scene). Agents can turn them on or off in **Settings → Video → Structures**. Some need 6 or 7 scenes. How the bridge and the call to action are worded rotates too, so endings stop sounding alike. The critic also scores **fresh**: whether a draft feels new next to the agent's recent videos.
- **Communication styles reach every scene.** An audience's style (Communicate) now shapes the opening and call to action (main style) and the middle (second style), passes on the words that land with that style and the ones that lose it, leans format and ending choices toward what suits it, gently checks for what loses it (urgency for Steady, hype for Careful, long lines for Direct; never blocking), scores style fit in the critic, and sets the voiceover's pacing.
- **Styles checked against real messages.** In the coach's **Reply to a message**, the agent can say which audience the sender belongs to. After 10 messages from an audience, Communicate shows which style they actually write in, with a one-tap change when it doesn't match the setting.
- **Overnight videos write one draft** (`OVERNIGHT_DRAFTS`, default 1). Nobody is waiting on them, and it roughly halves their AI cost. Videos made by hand keep the agent's Drafts setting.
- **The golden set** (section X). `node admin.js golden <workspace>` writes the same 12 video ideas with today's prompts and models; `golden-compare` puts two runs side by side. Use it before switching models or changing prompts.

**Phase 2: voice and footage** (section Y)
- **One take for the whole voiceover.** The script is read straight through in one recording, so the voice flows instead of restarting at every scene, then it's cut into scenes. The cuts come from word timings (a transcription, about half a cent per video) or, failing that, the pauses between sentences. If neither gives clean cuts, or the voice skipped a line, that video is recorded scene by scene as in v12, so a voiceover is never cut mid-word or missing a line. Word-by-word captions now appear when each word is actually spoken. Fixing a scene's spoken line records the take again. `VOICE_TAKE=scene` goes back to one recording per scene.
- **Pexels as a second footage source** (optional, free key). More variety and more vertical clips, mixed in with Pixabay. If Pexels is down, videos carry on with Pixabay.
- **No two agents post the same stock clip.** A clip any agent on the server used in the last 120 days (`SHARED_CLIP_DAYS`) is avoided for the others, the same way an agent's own recent clips are.
- **A shot list in Brand → Your own clips.** Ten shots to film in one sitting (at the desk, waving for the call to action, hands writing in a notebook, the town's main street…), ticked off as clips are uploaded and described. At 10+ clips the panel offers to use them in about half the scenes.

**Phase 3: a tidier coach and a proactive workflow** (section Z)
- **The coach answers what was asked.** Each question is sorted by what's on screen (a video, content, or general), and gets only the context and suggestion types that fit: no setup changes in answer to a question about one video. Answers are shorter (2–4 sentences), stop raising unrelated problems, and long chats send only the last few messages. It's cheaper per question too.
- **A cleaner coach panel.** One suggestion per answer, with any others folded under "more ideas". Follow-up questions appear when tapped. Things the coach should remember are saved quietly ("✓ Remembered…", one per answer), still removable in its Notes tab. Only plain preferences are saved that way: anything about rules, disclaimers, qualifying or promises is refused. **Communicate** has a **Draft a reply to a message** button.
- **Ideas for what's next** in **Create**: a worry coming into season in two weeks (make 3), facts due for review within a week, worries with no video in a month, formats not tried lately, and audiences with no confirmed facts, each with the one tap that fixes it. Content's checks also warn a week before facts fall due.
- **Monday plans, made for you** (opt-in, **Create → Overnight → Every Monday morning**). Between 6 and 10am the coach writes the week's check-in and makes its 3–5 videos, ready for review. **Skip next Monday** is one tap in Create or Review. It never runs twice in a week, never remakes a plan the agent already made by hand, and spends nothing when no video could be made (plan, monthly limit, AI cap).
- **Running-low alerts.** With a posting plan on, Review and Create say when there are fewer approved videos than posting days in the next 3 days. For done-for-you clients the app also makes enough videos for them to approve, and tells you.
- **Best posting time.** Once Instagram results show an hour where an agent's posts clearly do better (8+ posts with results), **Brand → Posting plan** suggests it, with one tap to use it.

**Phase 4: Studio** (section AA)
- **Create → Studio** builds one video by hand, for the agent or their assistant. Pick the audience, the worry, up to 3 confirmed facts, the format, the structure and the scene count, or a part of a ready-made **series** (Final Expense 101, Mortgage Protection 101, Protecting your family).
- **Openings:** a tap writes several, scored, and only ones that pass the rules are shown. Use one or write your own.
- **Scene cards** to write, reorder and edit, with live checks as you type. **Write the rest** fills only the empty cards and keeps what you wrote. **Rewrite** offers versions of one card and hides any that would break a rule. **Hear it** plays a line in the agent's voice.
- **Footage per scene:** search Pixabay, Pexels and the agent's own clips, see thumbnails and pick the clip. Scenes left empty get footage picked the usual way.
- **Render** runs the same checks as every video, plus two for hand-written scripts: the teaching scenes must say the confirmed fact, and no numbers that aren't in it. The finished video goes to Review like any other. Drafts save as you go (up to 20).


**Phase 5: tracking links and Facebook** (sections AB and AC)
- **A booking link for every video.** Add a scheduling page in **Brand → Booking link** (Calendly or similar, https). Each video gets its own short link (`yourdomain.com/r/…`) that opens that page and counts the click for that video. Review shows the link with a Copy button for Stories, replies and comments, plus its clicks. Review, the Posted list and **Admin** show click totals. Clicks count toward what the app learns works, at half a message each (up to 20 clicks per video). Link previews and bots aren't counted, and the same address counts once every 6 hours.
- **Cross-posting to Facebook Reels** (optional, needs a Meta app with Facebook Login). Agents connect their business **Facebook Page** in **Brand**. Any approved video can post to it now or at a set time from Review, including one already on Instagram. The Facebook post text adds the video's booking link above the small print, because links in Facebook posts can be tapped (on Instagram they can't). The **posting plan** can post to Instagram, Facebook or both.


**Still on your list from 12** (things only you can do on the real server):
- Run `bash setup-user.sh --dry-run`, then the real run (section U).
- Turn on `INSTAGRAM_INSIGHTS=1` and check results fill in for one real agent (section W).
- Decide whether approval records should be kept after a workspace is deleted, for carrier or state audits. Today they're deleted with it.
- Settings' locked rules and the coach's checks now read the platform rules from the workspace's niche. The starter content (`templates.js`) and the coach's fixed instructions are still life-insurance-only. That's fine until a second niche is added (section V).

---

## What's new in 12

Version 12 is the release-ready version: what you need to sell to other agents, keep their data safe, and run it without surprises. Everything new is off or harmless until you set it up; section A has the update.

- **Honest wording.** The app now says videos are **compliance-checked**: the checks catch risky wording, but they don't make a video compliant. The agent approves each video and stays responsible for it and for any carrier or state review. The Approve box in **Review** says so in one line, and every approval record keeps that line.
- **Terms of Service and Privacy Policy acceptance** (off until you set two links, section K). Agents tick a box when they accept their invite (or in setup), and the app stores which version they accepted and when. Change `TERMS_VERSION` and every agent is asked once more before they can keep working. Admin shows who has accepted.
- **AI voice disclosure.** Voiceover videos use an AI voice, so their post text now ends with the line *"Voiceover: AI-generated voice."* (above the agent's small print, which stays last). It's on for everyone by default; an agent can turn it off in **Brand → Voice → Say it's an AI voice**. Captions-only videos are unchanged. Videos already made keep their post text.
- **Email** (off until you add a Postmark or Resend key, section L). Invites and password-reset links are emailed (the link still shows in Admin to copy), agents can reset their own password from the login page, and agents get an email when their trial ends in 3 days, when a payment fails, and on Monday mornings when videos are waiting for review (they can turn that one off under **Account**).
- **Data download and deletion** (section M). Agents can download everything the app stores about them as one file (**Account → Your data**) and ask for their workspace to be deleted. You get an alert and confirm or decline it in **Admin**. A public page at `/data-deletion` explains how, for anyone who can't log in; it's the *data deletion instructions URL* Meta's App Review asks for.
- **AI spend guard** (section N). Each workspace has a monthly AI cost cap: $20 unless you set `AI_COST_CAP_USD`, or its own amount set in **Admin**. You get an alert at 80%; at 100% its new videos, test scripts and coach pause until next month (or until you raise the cap). Agents see a short note, as a percentage, not dollars.
- **Your prompts stay private** (section O). The way scripts are prompted is now built only on the server and never sent to a browser. Agents see *what goes into a video* in **Settings** (audience, worry, fact, format, scene plan), not the prompt text; you can still see the full prompt when you open their workspace. The coach won't recite its instructions either.
- **Security** (section O): stricter security headers, `__Host-` session cookies on https, shorter admin sessions (7 days), sessions end after 14 days unused, and **Account → Where you're logged in** to see devices and log out the others.
- **Two-factor login** (section O). Admins must set it up at their next login (a 6-digit code from an authenticator app, plus 10 one-time backup codes); agents can turn it on under **Account**. Lost phone: another admin taps **Reset 2FA** in Admin, or run `node admin.js reset-2fa their@email.com`.
- **Activity log** (section O). **Admin → Activity log** shows who did what and when: logins and failed logins (with IP), two-factor changes, admins opening a workspace, approvals and rejections, record and data downloads, deletion requests and deletions, plan, limit and cap changes, terms acceptance. Filter by workspace and kind, download as CSV. Each workspace's own entries are in its data download.
- **Landing page with "Request access"** (section P). `https://yourdomain.com/welcome` explains what the app does, shows your plans and prices (from Stripe), answers common questions, and links your terms, privacy policy and data-deletion page. Its form asks for access; it never creates an account. You get an alert, see the request in **Admin → Access requests**, and tap **Invite** to fill in the invite form. With email on, the person gets a "we got your request" email.
- **Encrypted off-site backups** (section Q). Each nightly backup is encrypted (AES-256-GCM, with a key only you hold) and uploaded to S3-compatible storage such as Backblaze B2 or Cloudflare R2. Old copies are removed after 30 days. Once a week the newest copy is downloaded, decrypted and checked, and you get an alert if anything fails. New terminal commands: `backup-now`, `restore-test`, `decrypt-backup`.
- **Monitoring** (section R). `/api/health` tells an uptime checker whether everything is fine (disk, backups, off-site copy, no video stuck rendering), so you get a text if the site goes down. You also get alerts for a burst of server errors, a late backup or a stuck video. Anyone whose account is used from a **new device** gets an email saying so, with what to do if it wasn't them.
- **Faster, sturdier videos.** Voiceover videos record the voice while the footage is being found (they used to take turns), and clips download while the next scenes are picked, so videos finish sooner. OpenAI calls retry outages with a short random wait. They no longer retry a bad key or an account that's out of credit: those videos fail straight away with a plain message saying what to fix. Emails get one more try after a provider hiccup. Pages that show how many videos are waiting no longer re-read every video each time, so the portal and Admin load faster as agents build up history.
- **Safer updates** (section S). `bash update.sh /root/update-v12.zip` (or a git pull) backs up, updates, runs the checks, restarts and checks the site answers. If the checks fail or the site doesn't come back, the previous version is put back by itself.
- **SQLite, when you want it** (section T). One command moves your data into a single database file with transactions and consistent backups. A dry run comes first and a rollback is one command.
- **Run as its own user** (section U). `setup-user.sh` moves the app off `root`. Your commands keep working as before.
- **Niches** (section V). Everything insurance-specific now lives in one file, ready for a second kind of business later. Nothing changes for your agents: a test proves the engine's output is byte-for-byte the same.
- **Seasonal topics, automatic Instagram results, yearly plans, referrals and agents' own clips** (section W).
- **Done-for-you clients on one screen** (section C): what needs you first, **Make 3 for everyone**, and re-confirming a client's facts in one go.
- **Help for agents**: with `SUPPORT_EMAIL` set, **Account** and **Guide** have a *Get help* button. The landing page shows a proper preview when its link is shared.
- **Server checklist** (end of section O): a few commands that lock the server itself down (SSH keys only, firewall, automatic security updates, fail2ban, private `.env`).

---

## What's new in 11

- **Communicate tab.** The four communication styles (DISC: Direct, Outgoing, Steady, Careful), how each audience likes to be spoken to, an **input workshop** that scores a worry, question, opening line, fact, audience or call to action and rewrites it for different styles, a **guess-the-style** practice, the fundamentals of honest selling mapped to each scene of a video, and a **Communication** mode for the coach. An audience's style shapes the wording of every script for it (never the facts or the rules).
- **Guide tab.** How the app works, a weekly routine, each tab, tips, compliance and common questions. Admins also see an admin section.
- **Instagram auto-posting** (off until you connect a Meta app, section F): post an approved video now, schedule it, or set a posting plan in **Brand**.
- **Word-by-word captions**, a **highlight color**, and your **logo** on the end card (**Brand**).
- **Alerts** in **Admin** (failed videos, failed payments, failed backups, low disk, Instagram problems), optionally pushed to your phone (section E).
- **Done for you** tracking: mark a workspace as managed, log your time on it, and see what it earns per hour.
- The message-reply helper now reads the sender's communication style and writes replies to fit.

---

## A. Update your server

### To version 15 (each phase)

Version 15 came as one zip per phase (`update-v15-phase-1.zip`, then 2, 3…), and ends with `update-v15-complete.zip`. Each contains the whole app, so the newest one is all you need (use its name in the commands below), whether you're on 14 or an earlier 15 phase.

**Coming from 14:** the update script you run is still 14's, whose backup before updating is a plain copy. Make a safe backup first (one command), then update:

```
cd /root/generator && node admin.js backup-now && bash update.sh /root/update-v15-phase-1.zip
```

The last line says `Now running version 15.0.0`. From 15 on, `update.sh` makes and checks its own backup and stops if it can't.

After updating, run `node admin.js models` to see which AI model does each job and when each is scheduled to shut down, then read section AK.

**Optional, once you're on 15:** keep each version side by side so going back is instant (section AO):

```
cd /root/generator && bash update.sh --use-releases
```

### To version 14 (each phase)

Version 14 comes as one zip per phase (`update-v14-phase-1.zip`, then 2, 3…). Each contains the whole app, so the newest one is all you need, whether you're on 13 or an earlier 14 phase:

```
cd /root/generator && bash update.sh /root/update-v14-phase-1.zip
```

The last line says `Now running version 14.0.0`. Agents' settings carry over; new settings get safe defaults.

### To version 13 (each phase)

Version 13 comes as one zip per phase (`update-v13-phase-1.zip`, then 2, 3…). Each one contains the whole app, so apply them in order, or just the newest. About two minutes each.

1. **Upload** the zip to `/root` with your terminal app's SFTP tab.
2. **Update:**
   ```
   cd /root/generator && bash update.sh /root/update-v13-phase-1.zip
   ```
   The last line says `Now running version 13.0.0`. If the checks fail or the site doesn't come back, the previous version is put back by itself.
3. Anything new in `.env` is optional; each phase lists it in **What's new in 13** and `.env.example`.

Nobody is logged out, and agents' settings carry over (new settings get safe defaults).

### To version 12 (from 11, or 8–10)

About five minutes, and a minute or two of the site restarting.

**1. Upload** `update-v12.zip` to `/root` with your terminal app's SFTP tab.

**2. Update** (the first line puts the new, safer `update.sh` in place; the second does the rest):
```
cd /root/generator && unzip -o /root/update-v12.zip update.sh
bash update.sh /root/update-v12.zip
```
It backs up `data/` and saves a copy of the current code, then unpacks the zip and runs all the checks. Then it restarts and makes sure the site answers. **If the checks fail or the site doesn't come back, it puts version 11 back by itself.** The last line says `Now running version 12.0.0`.

**3. Straight after:**
- **Everyone is logged out once** (on https the login cookie got a safer name), so tell your agents to expect it.
- **Log in as admin**: you'll be asked to set up **two-factor login**. Have an authenticator app ready and save the 10 backup codes.
- Save a copy of `/root/generator/.app-key` (created then) with your `.env`, in your password manager.
- In nginx, raise `client_max_body_size` to `200m` (section B) for agents' own clips: `nginx -t && systemctl reload nginx`.

Nothing in `.env` has to change. Everything new is optional and listed in `.env.example`. The recommended order is in section J. After editing `.env`, run `pm2 restart generator --update-env`.

### First install (no older version)

```
cd /root/generator
cp .env.example .env        # then fill in PUBLIC_URL, OPENAI_API_KEY and PIXABAY_API_KEY
npm test
pm2 start server.js --name generator
pm2 save
pm2 startup                  # prints one command: copy and run it
node admin.js create-admin you@youremail.com
```

`create-admin` prints a password once. Log in at your site and change it under **Account**.

---

## B. nginx

nginx passes everything to port 3100. The site's `server { … }` block needs:

```
    client_max_body_size 200m;     # agents upload their own clips (Brand); everything else is small

    location / {
        proxy_pass http://127.0.0.1:3100;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 120s;
    }
```

Then `nginx -t && systemctl reload nginx`. Check it's up: `curl -s http://127.0.0.1:3100/api/health` answers `{"ok":true,"checks":{…}}` (section R).

Instagram downloads each video from your site while posting, so the site must stay reachable at its public **https** address.

---

## C. Adding agents

People can also ask for access on your landing page (section P); their request shows in **Admin → Access requests** with an **Invite** button that fills this in for you.

**Admin → Invite**: their email, **New workspace** with their business name, and tick **No charge** for agents you don't bill (friends, family, testers). Copy the link and send it to them yourself (text or email). The link works once and expires in 7 days. After they set a password, setup takes about five minutes:

1. **About you**: name, title, city, states, Instagram handle.
2. **Who you help**: final expense, mortgage protection and/or family protection, and a sentence about their clients.
3. **How you sound**: captions or voiceover, energy, tone, call to action.
4. **Confirm your facts**: starter facts from the templates (plus up to three AI suggestions, clearly marked). Only facts they confirm are ever used.

Point them to the **Guide** tab afterwards. From **Admin** you can also open any workspace to help, pause it, comp it, change its monthly limit, or send a password reset link. From the terminal: `node admin.js list`, `node admin.js invite …`, `node admin.js reset …`.

When an agent leaves for good, cancel their subscription in Stripe, then `node admin.js delete-workspace <id> --yes` removes their workspace, videos and login. If they asked to be deleted from **Account**, confirm it in **Admin** instead (section M).

### Done for you clients

A done-for-you workspace is one you tune yourself: their facts, worries, audiences, styles and settings.

- In **Admin**, tap **Done for you** on their workspace (or set `MANAGED_PLAN=pro` so everyone on that plan counts as done for you).
- **Open** their workspace to work in it. The coach, workshop and **Try it first** all work there as they do for the agent.
- Log your time on their card in **Admin** (minutes and a short note). The card shows your total for the month and, when they pay through Stripe, what that client earns you per hour after AI costs.
- Their **Review** tab tells them the videos are tuned for them, so all they do is watch and approve. Turn on a posting plan in their **Brand** tab if they want approved videos posted for them.

---

**All your done-for-you clients on one screen.** **Admin → Done-for-you clients** lists every managed workspace. Those that need you come first, flagged with what's wrong:
- facts due for review, or no confirmed facts
- nothing waiting for review
- failed videos
- more rejections than approvals (with the top reason)
- AI spend near the cap
- paused

Each row shows what's waiting and in line, approvals and rejections over 30 days, the state of its facts, and your time this month and what it earns per hour. Totals sit on top.
- **Make 3 for everyone** (or **Make 3** on one row) queues videos for each client. Each goes through the same checks as the agent's own button (plan, monthly limit, AI cap, the 6-in-line limit), and anything that can't be made says why.
- **Confirm facts (N)** re-confirms a client's facts that are due for review or unconfirmed, after you tick that you've checked they're accurate for what that agent sells. Each is recorded as confirmed by you, in the facts and in the activity log. Facts that break a rule are never confirmed; fix them in Content. This only works for done-for-you workspaces; everyone else confirms their own facts.

## D. Plans, pricing and Stripe

Two plans, shown under the names you choose:

| Plan in `.env` | Suggested name | Videos a month | Suggested price |
|---|---|---|---|
| Starter | Solo | 30 | $150 / month |
| Pro | Done for you | 60 | $299 / month ($199 founding rate) |

Do it all in **test mode** first (the toggle at the top of the Stripe Dashboard).

1. **Product catalog → Add product**: "Solo", recurring, $150 monthly. Copy its price ID (`price_…`). Add "Done for you" the same way at $299.
2. **Founding rate** (optional): **Product catalog → Coupons → New**: $100 off, duration **Forever**, applies to the Done for you product only. Then add a **promotion code** to it, like `FOUNDING`, with a limit on redemptions (say 10). Checkout has a box for codes, so founding clients enter it there and pay $199 for as long as they stay.
3. **Developers → API keys**: copy the **Secret key** (`sk_test_…`).
4. **Developers → Webhooks → Add endpoint**:
   - URL: `https://yourdomain.com/api/stripe/webhook`
   - Events: `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_failed`, `customer.subscription.trial_will_end`
   - Copy the **Signing secret** (`whsec_…`).
5. **Settings → Billing → Customer portal**: turn on updating payment methods, canceling and switching plans (add both products), then save. Agents reach this from **Billing → Manage billing**.
6. Put the values in `.env`:
   ```
   STRIPE_SECRET_KEY=sk_test_…
   STRIPE_WEBHOOK_SECRET=whsec_…
   STRIPE_PRICE_STARTER=price_…
   STRIPE_PRICE_PRO=price_…
   PLAN_STARTER_NAME=Solo
   PLAN_STARTER_VIDEOS=30
   PLAN_STARTER_ABOUT=You run it: guided setup, the coach, overnight videos and Instagram posting.
   PLAN_PRO_NAME=Done for you
   PLAN_PRO_VIDEOS=60
   PLAN_PRO_ABOUT=We tune your content and prompts for you. You just watch and approve.
   MANAGED_PLAN=pro
   TRIAL_DAYS=14
   ```
   Then `pm2 restart generator --update-env`.
7. **Test**: invite yourself with another email, without **No charge**. In a private browser window, set it up, go to **Billing**, choose a plan and pay with card `4242 4242 4242 4242` (any future date, any CVC). Try the promotion code too. Billing should show **Free trial** or **Active** within a few seconds, and **Admin → Server** shows the time of the last Stripe event.
8. **Go live**: repeat steps 1–5 in live mode, put the live keys and price IDs in `.env`, restart.

Without Stripe keys, billing is off and every workspace gets `COMP_VIDEOS` videos a month. A failed payment shows in **Admin → Alerts**.

---

## E. Alerts on your phone

Everything that needs you shows in **Admin → Alerts**: a video that failed for good, a failed payment, a failed backup, low disk space, and an Instagram post that didn't go out. To also get them as phone notifications, the free **ntfy** app is the simplest:

1. Install **ntfy** on your phone and subscribe to a topic with a long, hard-to-guess name, like `agentreels-7f3k9q2m`. (Anyone who knows the name can read it.)
2. In `.env`:
   ```
   ALERT_WEBHOOK_URL=https://ntfy.sh/agentreels-7f3k9q2m
   ```
3. `pm2 restart generator --update-env`, then **Admin → Alerts → Send a test**.

A Slack or Discord webhook URL works too; the format is picked automatically. `LOW_DISK_GB` (default 3) sets when low disk space alerts you. The same alert isn't repeated within an hour.

---

## F. Instagram auto-posting

Agents connect their own Instagram once in **Brand → Instagram**. Then any approved video can **Post now** or be scheduled from **Review**, and a **posting plan** can post the oldest approved video on chosen days at a chosen time. Nothing is posted that the agent didn't approve. Their Instagram must be a **professional account** (Business or Creator; switching is free in Instagram's settings).

Instagram can't add a trending sound to automatic posts. Captions-only videos go out with a quiet audio track; voiceover videos post with their voice. The app tells agents this where it matters.

### 1. Create the Meta app

1. Go to **developers.facebook.com**, log in, and create a developer account if asked.
2. **My Apps → Create app**. Choose the use case **Manage messaging and content on Instagram**. Name it after your product (for example "Agent Reels").
3. In the app, open the Instagram use case's **API setup with Instagram login**.
4. Under **Set up Instagram business login** (business login settings), add the **OAuth redirect URI**. Copy it exactly from **Admin → Server → Instagram posting** once step 2 below is done; it is `https://yourdomain.com/api/instagram/callback`.
5. Copy the **Instagram app ID** and **Instagram app secret** shown on that page. (These are the Instagram ones, not the Facebook app ID at the top of the dashboard.)

Meta changes its dashboard wording now and then. If a menu name differs, look for "Instagram API with Instagram Login" and "business login settings".

### 2. Turn it on

In `.env`:

```
INSTAGRAM_APP_ID=…
INSTAGRAM_APP_SECRET=…
TOKEN_KEY=…            (run: openssl rand -hex 32, and paste the result)
```

`pm2 restart generator --update-env`. **Admin → Server** now shows **Instagram posting: OK** and the redirect URI. Each agent's Instagram key is stored encrypted with `TOKEN_KEY`, which isn't in `data/` or its backups. Don't change `TOKEN_KEY` later, or every agent has to reconnect.

### 3. Test with your own account

Until Meta reviews the app, only Instagram accounts with a role on it can connect.

1. In the app: **App roles → Roles → Add people → Instagram Tester**, and enter your Instagram username.
2. In Instagram on the web: **Settings → Apps and websites → Tester invites**, and accept.
3. In your own workspace: **Brand → Instagram → Connect Instagram**, approve, and you land back on Brand showing **Connected**.
4. Approve a video, then **Review → Post now**. It shows **Posting…** and, a minute or two later, moves to **Posted** with a link to the Reel.

### 4. Open it to your agents (App Review)

To let agents who aren't testers connect, the app needs **Advanced Access** to `instagram_business_basic` and `instagram_business_content_publish`, which means **App Review** and **Business Verification**:

- Complete **Business Verification** for your business in Meta Business settings.
- Add a **privacy policy URL** and an app icon in the app's basic settings.
- For **Data deletion**, choose *Data deletion instructions URL* and enter `https://yourdomain.com/data-deletion` (section M). Set `SUPPORT_EMAIL` first so the page shows where to write.
- Request Advanced Access for both permissions. For each, explain the use ("agents post Reels they approved in our app to their own Instagram account") and attach a short screen recording: connecting in Brand, approving a video, tapping Post now, and the Reel appearing on Instagram.
- When approved, switch the app to **Live**.

Review usually takes a few days and sometimes asks for changes. Until then, add each early agent as an Instagram Tester.

### Limits and troubleshooting

- Each account posts at most 10 videos a day through the app (Instagram's own limit is 50).
- Posting tokens are refreshed automatically before they expire (every 60 days). If an agent changes their Instagram password or removes the app, Brand shows **Reconnect** and you get an alert.
- A post that fails shows the reason on the video in **Review**, with **Post now** to try again, and alerts you.
- "Instagram posting needs PUBLIC_URL": set `PUBLIC_URL` to your https address and restart.

---

## G. Everyday use

| Want to… | Do this |
|---|---|
| Learn the app, or send an agent somewhere to learn it | **Guide** |
| See agents, plans, alerts, costs and server health | **Admin** |
| Make videos | **Create** → Make a video / Make 3, or pick a topic |
| Have videos waiting each morning | **Create → Overnight** (made 1–6am in the agent's time zone) |
| Review, approve, download and post | **Review** |
| Post to Instagram automatically | **Review → Post now / Schedule**, or a posting plan in **Brand** |
| Fix one bad clip or caption | **Review → Fix a scene** (no new script, back in about a minute) |
| Change facts, worries, audiences | **Content** |
| Set how each audience likes to be spoken to | **Communicate** |
| Make a worry, hook or fact land better | **Communicate → Input workshop** |
| Change the look, captions, logo or voice | **Brand** |
| Export approval records | **Review → Approval records** |
| Watch what the server is doing | `pm2 logs generator` |
| Update to a new version | unzip it into `/root/generator`, then `bash update.sh` |
| Test a full render after an update | `npm run test:full` (takes a few minutes) |

AI cost is roughly 5 to 10 cents per video, plus a fraction of a cent per coach answer. **Admin** shows each workspace's running estimate for the month, against its monthly cap (section N).

---

## H. Backups, disk and logs

- **Nightly backup** of `data/` (accounts, workspaces, settings, approval records) goes to `backups/`, 14 kept. Videos aren't in it; they're large and agents download what they post. A failed backup alerts you.
- **Off-site, encrypted copy** (section Q): set it up so a lost server doesn't mean lost data. Each nightly backup is encrypted and uploaded to cheap object storage, and once a week the newest copy is downloaded and checked.
- **Turn on Hetzner backups** too: Cloud Console → your server → **Backups** → Enable. It copies the whole server daily for about 20% of the server price.
- Now and then, download the newest file in `backups/` to your computer with SFTP, or run `node admin.js backup-now`.
- **Clean-up runs nightly**: rejected videos after 14 days, never-reviewed ones after 30, and video files 90 days after approval (the approval record stays). Change these in `.env` (`KEEP_…`).
- Keep logs from filling the disk: `pm2 install pm2-logrotate`
- Check free space any time in **Admin → Server**, or with `df -h /`.

---

## I. If something goes wrong

- **Site shows 502 Bad Gateway**: it isn't running. `pm2 status`, then `pm2 restart generator`, then `pm2 logs generator`.
- **A video "didn't finish"**: the reason shows under **Create → Videos in progress**, and in **Admin → Alerts** once it has failed for good. Failed videos don't count toward the month.
- **"No draft passed the checks"**: the AI broke a rule twice. Usually a fact is too long for its scenes or the caption limit is tight. **Content → Checks** flags most of these.
- **"Couldn't download the caption font"**: copy `Poppins-SemiBold.ttf` and `Poppins-SemiBoldItalic.ttf` into `/root/generator/fonts/`.
- **Someone forgot their password**: **Admin** → **Reset link** next to their name, and send it to them.
- **Too many login tries**: wait 15 minutes.
- **Billing doesn't update after paying**: in Stripe, **Developers → Webhooks → your endpoint**, check the latest events. A 400 usually means `STRIPE_WEBHOOK_SECRET` doesn't match.
- **Instagram connect says the redirect URI doesn't match**: the URI in the Meta app must be exactly the one in **Admin → Server**, including `https://` and no trailing slash.
- **Instagram connect works for you but not an agent**: the app isn't reviewed yet; add them as an Instagram Tester (section F.3) or finish App Review (F.4).
- **No alerts on your phone**: **Admin → Alerts → Send a test**. If it errors, check `ALERT_WEBHOOK_URL` and that your phone is subscribed to the same ntfy topic.

---

## J. Before you sell it to other agents

These are outside the code, and they're on you:

- **Terms of service and a privacy policy.** Stripe and Meta's App Review expect them, and agents should see them before paying. Once they're written, section K makes every agent accept them.
- **Stripe account details**: business name, support email and statement descriptor.
- **Each agent stays responsible for their own advertising.** Videos are compliance-checked; the checks don't make a video compliant. The platform blocks the risky wording it can detect, only teaches facts the agent confirmed, keeps an approval record for every video, and only ever posts videos the agent approved. Many carriers and states still require their own review of ads; the records help with that but don't replace it.
- **Communication styles are a working guess, not a label.** The Communicate tab teaches agents to read how a person writes and talks, never their age, culture or background, and to check each audience's style against which videos bring messages.

**Launch checklist, in order** (each step points to its section):
1. Update to 12 (A), set up two-factor login, and save `.env` and `.app-key` in your password manager.
2. **Off-site backups** (Q): `BACKUP_KEY` plus a bucket, then `node admin.js backup-now`.
3. **Uptime checker** on `/api/health` (R), and phone alerts (E).
4. **Server checklist** (end of O), then **run as its own user** (U).
5. **Terms and privacy** pages, reviewed by a lawyer (K). They need to mention the activity log, the request-access form, AI voices and Stripe.
6. **Email** with your domain verified, plus a DMARC record (L). Set `SUPPORT_EMAIL` (M).
7. **Stripe** in live mode (D). Set the plan names, optional yearly prices (W), and the webhook events (`customer.subscription.*`, `checkout.session.completed`, `invoice.payment_failed`, `invoice.paid`, `customer.subscription.trial_will_end`). Do one real run with a test card: trial, payment, failed payment, cancel.
8. **Instagram** App Review, the data-deletion URL and, if you want automatic results, the insights permission (F, M, W).
9. Read `/welcome` and `/data-deletion` on your site, and put `/welcome` in your bio.
10. One friendly agent for a week before inviting more.
11. Optional, any time: SQLite (T).

---

## K. Terms of Service and Privacy Policy

The app doesn't write your terms; it makes sure every agent has accepted them. Have a lawyer review them first.

1. Publish both pages somewhere public (your website, or a page in a site builder). Each needs its own **https** link.
2. In `.env`:
   ```
   TERMS_URL=https://yourdomain.com/terms
   PRIVACY_URL=https://yourdomain.com/privacy
   TERMS_VERSION=2026-10
   ```
   `pm2 restart generator --update-env`. Both links must be set, or the feature stays off.
3. From then on:
   - The invite page has a box: *"I've read and accept the Terms of Service and Privacy Policy"*. The account can't be created without it.
   - Agents who were already using the app see an **Updated terms** page the next time they open it, and accept once to carry on. Setup has the same box.
   - Each account stores the version it accepted and when (`termsVersion`, `acceptedAt`). **Account** shows it to the agent; **Admin** shows *terms accepted* or *terms not accepted yet* next to each person.
4. **When you change the terms**, update the pages, then change `TERMS_VERSION` (for example to `2027-01`) and restart. Everyone is asked again. Only the newest acceptance is kept on the account, so keep old versions of your terms pages yourself.

Admins are never asked: you run the service. The login page links to both pages, and the privacy policy link is what Meta's App Review asks for (section F.4).

---

## L. Email (invites, resets, billing and review reminders)

Without email set up, nothing changes: you copy invite and reset links from **Admin** and send them yourself. With it:

| Email | When |
|---|---|
| Invite | You create an invite in **Admin** |
| Password reset | You tap **Reset link** in **Admin**, or the agent uses **Forgot your password?** on the login page |
| Trial ending | About 3 days before a free trial ends (once per subscription) |
| Payment failed | Stripe couldn't charge the card |
| Videos ready for review | Monday from 8am in the agent's time zone, if videos are waiting (agents can turn it off under **Account**) |

**Postmark** (recommended for this kind of email) or **Resend** both work; you need one.

1. Create an account with the provider and **add your domain** (for example `yourdomain.com`).
2. The provider shows a few **DNS records** (DKIM, and a return-path or SPF record). Add them where your domain's DNS lives (your registrar or Cloudflare), then wait until the provider shows the domain as verified. Without this, emails land in spam or are refused.
3. Copy the key: Postmark → your Server → **API Tokens** → *Server API token*. Resend → **API Keys** → *Create API key* (sending access).
4. In `.env`:
   ```
   EMAIL_PROVIDER=postmark          (or resend)
   EMAIL_API_KEY=…
   EMAIL_FROM=Agent Reels <hello@yourdomain.com>
   EMAIL_REPLY_TO=you@yourdomain.com     (optional: where replies go)
   ```
   `EMAIL_FROM` must use the domain you verified. Then `pm2 restart generator --update-env`.
5. **Admin → Server** shows **Email: OK**. Test it: invite a second email address of yours, and try **Forgot your password?** on the login page.
6. In Stripe's webhook endpoint (section D.4), also tick `customer.subscription.trial_will_end`. (The app also checks once every 10 minutes, so trial emails still go out if you skip this.)

If an email can't be sent, the link still shows in **Admin** to copy, and background emails (billing, reminders) show up in **Admin → Alerts**.

---

## M. Your agents' data: download and deletion

Agents can take a copy of their data, or ask for it to be deleted, without writing to you.

**Download.** **Account → Your data → Download my data** gives one JSON file: their settings and every saved version, their video list, approval records, coach notes, usage and who's in the workspace. Password hashes, sessions and the Instagram token are never in it. Video files aren't either (they're large); approved videos download from **Review** while they're kept. It works even if they haven't accepted new terms, so someone who won't accept can still take their data and go.

**Deletion.** **Account → Your data → Delete my workspace and data**: they tick a box and can add a note. Nothing is deleted yet:

1. You get an alert (**Admin → Alerts**, and on your phone if section E is set up). With email on, they get an email saying the request arrived.
2. Their card in **Admin** shows **Deletion requested** with **Delete everything** and **Decline**. They can also cancel it themselves from **Account** until you act.
3. **Cancel their Stripe subscription first** if they have one (Stripe → Customers → them → cancel). The app won't delete a workspace with a subscription that will still charge them until you confirm you've done this.
4. **Delete everything**, then type the workspace name to confirm. It removes every login in the workspace (and logs them out), settings and their history, videos, covers and logo, approval records, coach notes, usage, the Instagram connection, videos waiting in line, and unused invite links. With email on, they get an email when it's done. If a video is rendering for them right then, try again in a few minutes.

Workspaces that didn't ask are still deleted from the terminal: `node admin.js delete-workspace <id> --yes`.

What's kept: nightly backups in `backups/` hold a copy until they rotate out (`KEEP_BACKUPS`, 14 days by default), Stripe keeps its own payment records, and Reels already posted stay on Instagram. Approval records are deleted with everything else, so if an agent may need them for a carrier or state audit, remind them to download their data (or the records in **Review**) first.

**The public page.** `https://yourdomain.com/data-deletion` needs no login. It tells people how to download and delete their data, how to remove Instagram access, what gets deleted and what's kept. The login page links to it. Set where people write when they can't log in:

```
SUPPORT_EMAIL=privacy@yourdomain.com
```

(If it's empty, the page uses `EMAIL_REPLY_TO`; if that's empty too, it tells them to contact whoever set up their account, which isn't enough for Meta's review.) `pm2 restart generator --update-env`, then open the page to check it. The page says requests are handled once you confirm them; check the wording matches your privacy policy.

---

## N. AI spend guard (monthly cost cap)

Every call to OpenAI costs a little, and the app adds up an estimate per workspace (the **AI cost this month** figure in **Admin**). The spend guard stops one workspace from running up a large bill, for example through a bug, a stuck retry, or someone running test scripts all day.

- **The cap**: $20 per workspace per month by default. Change the default in `.env`, then `pm2 restart generator --update-env`:
  ```
  AI_COST_CAP_USD=20        (0 = no cap)
  ```
  For one workspace, tap **AI cap** on its card in **Admin** and enter an amount (blank = back to the default, 0 = no cap for that workspace). A done-for-you client you coach a lot may need more.
- **At 80%** you get an alert (**Admin → Alerts**, and on your phone if section E is set up). Once a month per workspace.
- **At 100%** you get another alert, and for that workspace the app stops starting anything that calls the AI: new videos (including overnight ones), scene fixes, test scripts, footage tests and the coach. Videos already waiting in line stop with the same reason. A video that's already rendering finishes. Setup still works, with the starter wording. Review, approving, downloading and Instagram posting keep working. The agent sees a note saying the month's AI budget is used up and that you can raise it; they never see dollar amounts.
- **It resumes** on the 1st of the month (UTC), or right away when you raise the cap.

For scale: a video is roughly 5 to 10 cents and a test script about a cent, so $20 is several times a normal month. The figures are estimates from a price table (`OPENAI_PRICES` in `.env`); check your real spend in the OpenAI dashboard, and set a monthly budget there too (**Settings → Limits**) as a backstop for the whole server.

---

## O. Security

What the app does to protect agents' accounts, their data and your work. Most of it needs nothing from you; the server checklist at the end does.

**Your prompts.** How scripts, hooks, critics and post text are prompted lives in `lib/prompts.js`, which only the server loads. The portal gets `mixer-core.js` (the rules and checks, so agents see problems before saving) but none of the prompt text. Agents see the *ingredients* of a video in **Settings → What goes into a video**; admins also get **Show the full prompt** and **Explain this prompt** there. Test scripts only include the prompt for admins, and the coach is told to keep its instructions to itself. (Like any AI product, a determined person can still guess a lot from the scripts it writes; this keeps the exact wording off their screen.)

**Logins and sessions.**
- Passwords are stored as scrypt hashes; login tries are rate-limited per IP and per email.
- On https the session cookie is `__Host-sid` (HttpOnly, Secure, SameSite=Lax): only your site can read or send it.
- Sessions last 30 days for agents and **7 days for admins**, and end after **14 days unused**. Change with `ADMIN_SESSION_DAYS` and `SESSION_IDLE_DAYS` in `.env`.
- **Account → Where you're logged in** lists each device (browser, IP, last active) with **Log out** and **Log out everywhere else**. Changing a password logs out every other device.

**Two-factor login.**
- **Admins must use it** (the first time you log in after updating, the app walks you through it). Agents can turn it on under **Account → Two-factor login**. `TWO_FACTOR=all` in `.env` requires it for everyone; `TWO_FACTOR=off` makes it optional for admins too (not recommended).
- Any authenticator app works: Google Authenticator, Microsoft Authenticator, 1Password, Authy. Scan the QR code (made on your server, never sent anywhere), enter the code, and **save the 10 backup codes**. Each backup code works once.
- After a password, the login asks for the code. A password-reset link doesn't skip it.
- **Lost phone and backup codes**: another admin taps **Reset 2FA** next to the person in **Admin** (check it's really them first, for example by phone), or on the server: `node admin.js reset-2fa someone@example.com`. They're logged out and set it up again.
- The 2FA keys are encrypted with a key kept in **`/root/generator/.app-key`** (created automatically, readable only by the server's user), or `APP_KEY` in `.env` if you set one. It isn't in `data/` or the backups. **Save a copy of `.app-key` with your `.env`** (in your password manager): if you rebuild the server from a backup without it, everyone's two-factor login has to be reset.

**Activity log.** Every security- or compliance-relevant action is written to `data/audit/YYYY-MM.jsonl` (one line per event, append-only) and shown in **Admin → Activity log**, filterable by workspace and kind, with **Download (CSV)**. It's kept **24 months** (`AUDIT_KEEP_MONTHS`), then removed by the nightly cleanup. It records logins and failed logins with IP, two-factor and password changes, devices logged out, admins opening a workspace and changing its settings (comp, pause, limits, AI cap), invites and reset links, approvals, rejections and posted marks, record and data downloads, deletion requests, declines and deletions, Instagram connect/disconnect, setup, saved settings and terms acceptance. Terminal commands (`node admin.js …`) are recorded as "cli". An agent's data download includes their workspace's entries, with admins shown only as "admin".
It stays after a workspace is deleted (it's a security record); the public deletion page says so. Mention it in your privacy policy too.

**Headers.** Every response sends `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, a strict `Content-Security-Policy` on pages, `Permissions-Policy` (no camera, microphone, location or payment access), `Cross-Origin-Opener-Policy`, and on https `Strict-Transport-Security`.

**Server checklist** (once, on the server; Ubuntu). These protect the machine itself:
```
chmod 600 /root/generator/.env /root/generator/.app-key        # only root can read your keys
apt install -y unattended-upgrades fail2ban                    # automatic security updates; blocks SSH password guessing
dpkg-reconfigure -plow unattended-upgrades                     # answer Yes
ufw allow OpenSSH && ufw allow 'Nginx Full' && ufw enable      # firewall: only SSH and the website
```
**SSH keys only**: first make sure you can log in with your SSH key. Then, in `/etc/ssh/sshd_config`, set `PasswordAuthentication no` and `PermitRootLogin prohibit-password`, and run `systemctl reload ssh`. Keep your current session open until a new login with the key works. The app itself already listens only on 127.0.0.1, behind nginx. In nginx's `http { }` block, `server_tokens off;` hides its version.

---

## P. Landing page and access requests

The app stays **invite only**. `https://yourdomain.com/welcome` is a public page for agents who hear about you: what the app does, how it works, your plans, common questions, and a **Request access** form. The login page links to it ("New here? Request access").

**What it shows.**
- **Plans and prices** come from Stripe (the same plans as **Billing**, names from `PLAN_…_NAME`, videos from `PLAN_…_VIDEOS`, and the line in `PLAN_…_ABOUT`). With billing off, it says to ask about pricing. Stripe IDs are never shown.
- The free-trial line appears when `TRIAL_DAYS` is set.
- The footer links your Terms of Service and Privacy Policy (section K), the data-deletion page, Log in, and `SUPPORT_EMAIL`.
- The page sets no cookies and loads no trackers.

**The form** asks for name, email, and optionally phone, business, licensed states, what they sell, how they heard about you and a note, plus a consent box to be contacted.
- It's saved in `data/access-requests.json`. **No account is created.**
- You get an alert (**Admin → Alerts**, and your phone if section E is set up), and the activity log records it.
- With email on (section L) they get a short "we got your request" email. It promises no date.
- The same email asking again within a day updates their request without another alert or email.
- **Spam protection**: a hidden field bots fill in, and forms sent within 2.5 seconds of the page loading, get a normal "thanks" and are thrown away. Each address can send 5 requests an hour.

**Handling requests.** **Admin → Access requests** lists new ones with their details. **Invite** fills the invite form (email, and their business as the workspace name): check it, tick **No charge** if needed, then **Create invite link**. Their request is marked invited. **Dismiss** the ones you don't want; **Reopen** brings one back. Handled requests are removed after 180 days (`ACCESS_KEEP_DAYS`); new ones stay until you handle them.

**Using it.** Put `https://yourdomain.com/welcome` in your Instagram bio, email signature and ads. Your privacy policy should mention that the form collects these details to contact people about access.

---

## Q. Off-site encrypted backups

Nightly backups (section H) sit on the same server as the app. If the server is lost, so are they. With this set up, each nightly backup is also **encrypted and copied to object storage elsewhere**. A few cents a month covers it.

**What's in it.** The same as the nightly backup: `data/` (logins, workspaces, settings and their history, video records and approval records, the activity log, access requests). Video files aren't included. It's encrypted with AES-256-GCM before it leaves the server, so the storage company only ever sees scrambled bytes.

**1. Make a key** and save it in your password manager **before** anything else. Without it, nobody can read these backups, including you.
```
openssl rand -hex 32
```

**2. Make a bucket.** Any S3-compatible storage works. For example, Backblaze B2:
1. Create a **private** bucket (e.g. `agent-reels-backups`).
2. Under **Application Keys**, add a key limited to that bucket with read and write access.
3. Note the bucket's endpoint (e.g. `s3.us-west-004.backblazeb2.com`); the region is the middle part (`us-west-004`).

Cloudflare R2 (region `auto`), Wasabi, AWS S3 and DigitalOcean Spaces work the same way.

**3. Add to `.env`**, then `pm2 restart generator --update-env`:
```
BACKUP_KEY=<the 64 characters from step 1>
BACKUP_S3_ENDPOINT=https://s3.us-west-004.backblazeb2.com
BACKUP_S3_BUCKET=agent-reels-backups
BACKUP_S3_REGION=us-west-004
BACKUP_S3_ACCESS_KEY=<keyID>
BACKUP_S3_SECRET_KEY=<applicationKey>
# BACKUP_S3_PREFIX=agent-reels/     (folder inside the bucket)
# BACKUP_S3_KEEP_DAYS=30            (older copies are removed; the newest 3 always stay)
```

**4. Test it now** instead of waiting for tonight:
```
cd /root/generator && node admin.js backup-now
```
It backs up, encrypts, uploads, then downloads the copy and checks it. You should see `uploaded agent-reels/data-….tar.gz.enc` and `restore test passed`. **Admin → Server → Off-site backup** shows the last upload and the last restore test.

**Every night** the new backup is uploaded and copies older than `BACKUP_S3_KEEP_DAYS` are removed. **Once a week** the newest copy is downloaded, decrypted and unpacked into a temporary folder (never over your live data). The check confirms the logins, workspaces, settings and video records all read correctly. If an upload or a restore test fails you get an alert, and the local backup is still in `backups/`.

**Restoring after a disaster** (new server, same steps as a first install in section A):
1. Install the app, then put your saved `.env` and `.app-key` back in `/root/generator/`. `.app-key` unlocks two-factor logins; without it, everyone's two-factor login has to be reset.
2. Download the newest `.tar.gz.enc` from your bucket (the provider's website works), and copy it to the server.
3. Restore it:
   ```
   cd /root/generator
   pm2 stop generator
   node admin.js restore-test data-2026-10-15.tar.gz.enc        # check it first
   node admin.js decrypt-backup data-2026-10-15.tar.gz.enc /root/restore.tar.gz
   mv data data-before-restore && mkdir data && tar -xzf /root/restore.tar.gz -C data
   pm2 start generator
   ```
4. Log in and check **Admin**. Videos made before the backup show as records; their files weren't in the backup.

(After section U, the folder is `/srv/generator`; `/root/generator` is a link to it.)

**Keep safe, off the server:** `.env` (it has `BACKUP_KEY`) and `.app-key`. A password manager is ideal.

Other commands: `node admin.js restore-test` checks the newest off-site copy, and `node admin.js restore-test backups/data-2026-10-15.tar.gz` checks a local one.

---

## R. Monitoring

**Uptime checker (free, 5 minutes).** Use [UptimeRobot](https://uptimerobot.com) or [Better Stack](https://betterstack.com):
1. Add an **HTTP(s)** monitor for `https://yourdomain.com/api/health`, checked every 5 minutes.
2. Set it to alert you by text or app notification.

It answers **200** when everything is fine and **503** when something needs you, so the checker alerts you if the site is down *or* unhealthy. The checks are:

| Check | Fails when |
|---|---|
| `disk` | Free disk is under `LOW_DISK_GB` (3 GB) |
| `backup` | No nightly backup for 36 hours (`BACKUP_LATE_HOURS`) |
| `offsite` | (only when section Q is set up) the last upload failed or is 36+ hours old |
| `queue` | A video has been rendering for more than 30 minutes (`JOB_STUCK_MINUTES`) |

Strangers only see `ok` and the check names. To see the numbers (free disk, last backup, queue, recent errors, version), set `HEALTH_TOKEN=` (any 16+ random characters, e.g. `openssl rand -hex 16`) and open `/api/health?token=…`. **Admin → Server → Health check** shows the same checks.

**Alerts the server sends you** (**Admin → Alerts**, and your phone with section E):
- **The server is throwing errors**: 5 unexpected errors within 10 minutes (`ERROR_BURST`). At most every 30 minutes. Look at `pm2 logs generator --lines 100`.
- **The nightly backup is late**, **The off-site backup is late**, **A video has been rendering for too long**: once a day each, until fixed.
- Existing ones: failed videos, failed payments, failed backups and uploads, the weekly restore test, low disk, Instagram problems, AI spend.

**New-login emails** (with email on, section L). When someone logs in to an account from a device and network it hasn't used before, its owner gets an email: which device, the IP address and the time, plus what to do if it wasn't them (change password, log out other devices, turn on two-factor login, tell you). Their first login, and logins straight from an invite or reset link, don't send one. "Network" is broad (the first half of the IP address), so a phone moving between cell towers doesn't count as new.

---

## S. Updating the app (zip or git)

`update.sh` updates safely. It:
1. Backs up `data/`.
2. Saves a copy of the current code.
3. Updates the code and runs the checks.
4. Restarts, then makes sure the site answers.

**If the checks fail, the previous code is put back and the running site is never restarted. If the new version won't start, the previous one is put back and restarted.** Your data, videos, backups, fonts, music, `.env` and `.app-key` are never changed or restored by an update.

**With a zip** (the usual way): upload it to `/root`, then:
```
cd /root/generator && bash update.sh /root/update-v12.zip
```
A zip that contains `data/`, `videos/`, `backups/`, `.env` or `.app-key` is refused before anything changes.

**With git** (optional, for faster updates): keep the code in a **private** GitHub repository. `.gitignore` already keeps data, media and keys out of it. Once:
```
cd /root/generator
git init -b main && git add -A && git commit -m "v12"
git remote add origin git@github.com:YOU/agent-reels.git && git push -u origin main
```
(On GitHub: **Settings → Deploy keys** → add the server's `~/.ssh/id_ed25519.pub`, tick *Allow write access* only if you push from the server.) After that, each update is:
```
cd /root/generator && bash update.sh            # newest version
bash update.sh v12.0.0                           # a specific tag or commit (to go back: bash update.sh main)
```
If someone edited files on the server by hand, a git update stops and lists them instead of overwriting them.

`bash update.sh --no-pull` runs the checks and restarts with the files as they are (no automatic rollback).

---

## T. Storage: JSON files or SQLite

**From version 15, SQLite is the standard**: new installs start on it, and an update moves a server on JSON files into it once (section AL). The rest of this section explains both and how to move by hand.

Before 15 the app kept its data as JSON files in `data/` by default. That works well for a handful of agents. **SQLite** (built into Node 22, nothing to install) keeps the same data in one file, `data/app.db`. With SQLite:
- Every change is a transaction, so the server and `node admin.js` can never overwrite each other's changes.
- Backups take a consistent copy even while the server runs.
- It keeps working smoothly as you grow past a few dozen agents.

Nothing else changes. The app and the portal work the same, and videos, logos, settings history and the activity log stay as files.

**Moving to SQLite** (about a minute of downtime; do it at a quiet time):
```
cd /root/generator
node admin.js storage migrate --dry-run     # reads every file; changes nothing
pm2 stop generator
node admin.js storage migrate               # copies, checks every document, then switches
pm2 start generator
node admin.js storage status
```
The migration copies everything in one go and reads each document back to check it. Only then does it move the JSON files aside to `data/json-before-sqlite-<date>/` (kept, never deleted) and switch. If anything doesn't match, it removes the database and changes nothing. It refuses to run while the server is running, or if any file is damaged (it lists which).

**Going back** (everything written since the move is kept):
```
pm2 stop generator && node admin.js storage rollback && pm2 start generator
```
The database is kept as `data/app.db.rolled-back-<date>`.

**Admin → Server → Storage** shows which one is in use. Backups (including off-site ones) and `node admin.js restore-test` work with either. A restored SQLite backup unpacks as `data/app-snapshot.db`, and the server picks it up automatically.

Needs Node 22.5 or newer (`node --version`). On older versions the server says so and tells you how to switch back.

---

## U. Run the app as its own user (not root)

Out of the box the app runs as `root`. That's fine to start with, but if the app were ever broken into, the attacker would control the whole server. Running it as its own user, `reels`, limits any damage to the app's own folder. It takes one script and about a minute of downtime:

```
cd /root/generator
bash setup-user.sh --dry-run     # shows every step; changes nothing
bash setup-user.sh
```
It:
1. Creates the user `reels` (no password, can't log in).
2. Moves the app to `/srv/generator` and leaves a link at `/root/generator`, so every command in this guide still works.
3. Gives the folder to `reels`, with `data/`, `backups/`, `.env` and `.app-key` readable by it alone.
4. Moves the app's pm2 process, and its start-on-boot, to `reels`.
5. Checks that the site answers.

**Afterwards, nothing changes for you.** `bash update.sh …` and `node admin.js …` still run from `/root/generator` as root. They switch to `reels` by themselves, so they never create files the app can't use. (`KEEP_ROOT=1 node admin.js …` stays root, for example to write a decrypted backup into `/root`.) The app's pm2 is the `reels` user's:
```
runuser -u reels -- env HOME=/home/reels pm2 status      # or: logs generator / restart generator
```
To undo: `bash /srv/generator/setup-user.sh --undo`.

Together with the server checklist at the end of section O (SSH keys only, firewall, automatic updates, fail2ban), this is the standard way to lock down a small server.

---

## V. Niches (for later)

Everything that makes the app about **life insurance** is in one file, `niches/life-insurance.js`:
- products
- the compliance floor every agent gets (banned phrases, required statements)
- words that sound government-backed
- "you'll qualify" promises and absolute claims
- footage words to avoid
- how prompts describe the agent

Each workspace's settings name their niche (`life_insurance`); anything without one is life insurance. Nothing changes for your agents. A test proves the engine's output (every prompt, rule and check) is byte-for-byte what it was before the move.

To serve another kind of business later (for example Medicare supplements, or real estate), copy that file, change its content, add it to `niches/index.js`, and add starter facts for it in `templates.js`. A few places still use the default niche directly (the coach's rule summary, setup, and the Settings screen's locked rules); they'd need the workspace's niche passed in before a second niche goes live.

---

## W. Seasons, automatic results, yearly plans, referrals and agents' own clips

**Seasonal topics** (nothing to set up). In **Content → Worries**, each worry has *In season*: tick the months it fits, and in those months it comes up about 3× as often (in the agent's time zone). The tab also suggests this month's moment, such as September's Life Insurance Awareness Month, December's family time or January's fresh start. Untagged worries work exactly as before.

**Automatic Instagram results** (optional; posts must go through the app's Instagram connection, section F):
1. In your Meta app, add the permission **`instagram_business_manage_insights`**, and request Advanced Access for it in App Review (same process as F.4).
2. `.env`: `INSTAGRAM_INSIGHTS=1`, then restart.
3. Agents reconnect once: **Brand → Instagram** shows *Reconnect* to allow results.

Every day, videos posted in the last 30 days get their views, reach, likes, comments, shares and saves from Instagram, including ones posted by hand that have their Instagram link. Messages can't be read from Instagram, so each posted video has an **It brought a message** button. Messages are what decide which topics come up more often.

**Yearly plans** (optional). In Stripe, add a second, **yearly** price to each product (for example 10× the monthly price, so 2 months free), then:
```
STRIPE_PRICE_STARTER_YEARLY=price_…
STRIPE_PRICE_PRO_YEARLY=price_…
```
**Billing** then shows a Monthly / Yearly switch with how much a year saves. Yearly plans renew yearly and get the same videos per month.

**Referrals** (on whenever billing is). Each agent's **Billing** page shows a referral link (`/welcome?ref=CODE`). Someone who requests access from that link arrives in **Admin → Access requests** marked *Referred*, and **Invite** fills in the code. You can also type a code in the invite form. When the referred agent makes their **first real payment** (not a $0 trial invoice), the referrer gets **one month's credit** on their Stripe balance, which Stripe takes off their next invoice. It's once per referred agent, and credits stack. You get an alert each time. A referrer without a paid plan (comped, say) isn't credited, and the alert says why. **In Stripe's webhook endpoint (D.4), also tick `invoice.paid`.**

**Agents' own clips.** **Brand → Your own clips**: agents upload short clips of themselves (straight from their phone; any format is re-encoded on arrival, sound removed, 60 seconds at most), describe each in a few words, and pick how often they're used:
- **A little**: the last scene (their call to action) and the first.
- **A lot**: about half the scenes.

A clip whose description shares words with a scene's footage search goes to that scene, the least-used clips go first, and no clip appears twice in one video. Fixing a scene still works, and a deleted clip is replaced with stock footage. Uploads need nginx's `client_max_body_size 200m;` (section B), then `nginx -t && systemctl reload nginx`. Limits: `LIBRARY_MAX_CLIPS` (40) and `CLIP_UPLOAD_MAX_MB` (200).

---

## Y. Voice and footage

**Single-take voiceover.** On by default. Each voiceover video makes one speech recording and one transcription (whisper-1, about $0.006 a minute; `OPENAI_TRANSCRIBE_MODEL` to change it, though it must return word timestamps). The video's log in **Create → Videos in progress** says how the take was cut: `by word timings` (best) or `by pauses`. Cuts sit halfway between scenes, so a word the transcription misheard is never dropped. If there are no clean cut points, or the voice skipped a line, that video is recorded scene by scene instead (the log says why). To go back to recording each scene separately for everyone: `VOICE_TAKE=scene` in `.env`, then `pm2 restart generator --update-env`.

**Pexels** (optional):
1. Make a free account at pexels.com and get an API key at **pexels.com/api**.
2. In `.env`: `PEXELS_API_KEY=…`, then `pm2 restart generator --update-env`.
Search results are mixed with Pixabay's (alternating), go through the same blocked-content filter (funerals, hospitals, churches, animals…), and the AI clip check scores them the same way. A clip that won't download is replaced with one of the scene's spares. Pexels clips are free to use and don't require credit; Pexels asks for a link back where practical, such as your landing page. Videos never stop because of Pexels: if it fails, the log notes it and Pixabay carries on.

**Shared clip list.** `data/used-clips-all.json` holds clip ids, workspace ids and dates (nothing else). `SHARED_CLIP_DAYS=120` by default; `0` turns it off (and stops recording). Other agents' clips are avoided more gently than an agent's own: if they leave nothing good for a scene, they're allowed again before falling back to an unchecked reuse. A deleted workspace is removed from the list (from Admin or the terminal).

**Shot list.** Lives in `niches/life-insurance.js` (`shotList`), so a second niche brings its own. A shot counts as filmed when a clip's description uses one of its words ("me at my desk" ticks the desk shot).

---

## X. Writing quality: models, structures, styles and the golden set

**Models.** Each job can have its own model in `.env` (all optional; anything unset uses `OPENAI_MODEL`, and `OPENAI_MODEL` unset is `gpt-4o`):
```
OPENAI_MODEL=…            # writes scripts and post text
OPENAI_HOOK_MODEL=…       # writes the 8 openings
OPENAI_CRITIC_MODEL=…     # ranks openings and drafts (best as a different model from the writer)
```
Check the model names your OpenAI account can use at platform.openai.com. Add any new model's price to `OPENAI_PRICES` (section N) so the spend guard's estimate stays right, for example `OPENAI_PRICES={"new-model-name":[1.25,10]}` (dollars per million input and output tokens). Then `pm2 restart generator --update-env`.

**Before you switch models, run the golden set:**
```
cd /root/generator
node admin.js list                                    # find the workspace id (for example Melanie's)
node admin.js golden w_abc123 --label current         # today's model
OPENAI_MODEL=new-model-name node admin.js golden w_abc123 --label new-model
node admin.js golden-compare data/golden/<current file>.json data/golden/<new-model file>.json
```
Each run writes 12 fixed video ideas (same audience, worry, fact, format and structure every time) without making videos, about a cent each, counted on that workspace's AI usage. `golden-compare` writes an HTML page next to the second file: download it with SFTP and read it row by row. Ask which script you'd approve; the critic's averages at the top are a hint, not the verdict. Run it again after any prompt change. `--count 20` for more cases.

**Structured outputs** are on by default. `OPENAI_STRUCTURED=off` turns them off (for a provider behind `OPENAI_BASE_URL` that doesn't support them; OpenAI models that don't are detected and fall back automatically).

**Structures** are in **Settings → Video → Structures** for each agent: Classic (always on), Answer first (6+ scenes), Objection (7+), Recap (7+) and Straight to you. Lists, comparisons and mini-stories keep the Classic shape. The structure each video used shows on its card in **Review** and in test scripts. Fixing a scene keeps the video's structure.

**Communication styles** (Communicate) now reach every scene of the script, the critic and the voiceover's pacing. The style checks are soft: they give the writer one chance to reword, and never stop a video.

**Checking a style against real messages.** In the coach → **Reply to a message**, pick the sender's audience when you paste a message in. Only the audience, the style letter and the time are kept (`style-reads.json`, in the agent's data download). After 10 messages from an audience, its card in **Communicate** shows how their messages read and, when 60% or more lean one style that isn't the main one set, a button to use it.

**Overnight drafts.** `OVERNIGHT_DRAFTS=1` (default; 1–3) for overnight videos only.

---

## Z. The coach and the proactive workflow

**Nothing to set up.** Everything in Phase 3 works with what's there.

**The coach.** A question with a video in focus (Ask the coach on a video in Review) is a *video* question: it can suggest scene fixes, footage searches, rules and voice changes, nothing else. Content, Communicate and Settings, or a fact, audience or test script in focus, make it a *content* question. Anything else is *general*. The kind is decided in code, so it costs nothing. The Communication coach is unchanged.

**Monday plans.** Off by default; each agent (or you, in a done-for-you client's workspace) turns it on in **Create → Overnight**. It runs once a week, Monday between 6 and 10am in the agent's time zone, through the same checks as making videos by hand (plan, monthly limit, AI cap, confirmed facts). The check-in says *Made automatically*. A skipped week is remembered on the workspace.

**Running low.** Checked once a day after 7am in the agent's time zone. For done-for-you workspaces it queues at most 3 videos (fewer if some are already waiting for review) and sends an info alert to **Admin → Alerts**. Solo agents only see the note.

**Best posting time** needs Instagram results (section W, or results added by hand): at least 8 posted videos with views, 3 or more at the winning hour, and that hour 25% or more above the agent's average (a message counts like 150 views).

## AA. Studio

**Nothing to set up.** Studio uses the same OpenAI, Pixabay and (optional) Pexels keys as everything else.

**What it costs.** Each helper tap (openings, write the rest, rewrite, footage, hear it) counts toward the daily limit shared with test scripts (`SCRIPT_TESTS_PER_DAY`, default 30) and the AI spend cap (section N). Rendering counts as one of the month's videos, like any other. A draft that's rendering can't be edited. If its job is canceled or fails, the draft goes back to being a draft with the reason shown.

**What it can't do.** It can't teach anything that isn't a confirmed fact linked to the worry. It can't skip the platform rules, the disclaimer or the qualifying checks. It can't add numbers the fact doesn't have. A list format's count is the one exception, so "3 things…" is fine with 3 facts.

**Series.** Series are defined in the niche file (`niches/life-insurance.js`, `series`). Each part suggests a format, and the post starts with "Final Expense 101 · Part 2 of 5". To add one, copy an entry; it appears in Studio after a restart.

**Where drafts live.** Drafts are kept in the workspace's `studio.json`. They’re included in backups and in the agent’s data download, and deleted with the workspace.

## AB. Tracking links

**Set up:** each agent adds their booking page in **Brand → Booking link**. It must be https. Nothing to do on the server, but `PUBLIC_URL` must be set, since the links are built from it.

**How it counts.** A click is counted on the video the link belongs to, then the viewer goes straight to the booking page. These aren't counted: link previews (Facebook, iMessage, Slack, WhatsApp…), known bots, and the same network address again on the same link within 6 hours. One address counts at most 20 clicks an hour across all links, and one video at most 200 a day. Nothing about who clicked is stored. Clicks are written every few seconds, not one at a time. Clicks show per video in Review and Posted, as a monthly total in Review, and per workspace in **Admin**.

**What it can't do.** Links in Instagram captions can't be tapped. On Instagram the link works in Stories (link sticker), in replies to messages and in the bio. The Facebook posts the app makes include it automatically. If the agent removes their booking link, or the workspace is paused, the links show a short "This link isn't active right now" page.

**Where it's kept.** Codes are in `data/links.json`, and clicks are on each video. They're removed with the video or the workspace.

**Not included:** automatic replies to a DM keyword ("message me PLAN"). That needs Instagram's messaging permission and its own App Review; it's on the list for later.

## AC. Facebook Page cross-posting

Works like Instagram auto-posting (section F), with Facebook's own login. Agents need a **Facebook Page** (not a personal profile) where they're an admin or editor.

**1. The Meta app.** You can use the same Meta app as Instagram. At **developers.facebook.com**, open the app:
1. Add the use case **Manage everything on your Page** (or add the product **Facebook Login for Business**).
2. Ask for the permissions `pages_show_list`, `pages_read_engagement` and `pages_manage_posts`.
3. Under **Facebook Login → Settings**, add the **Valid OAuth redirect URI** exactly as **Admin → Server → Facebook posting** shows it: `https://yourdomain.com/api/facebook/callback`.
4. Copy the **App ID** and **App secret** from **App settings → Basic**. These are not the Instagram app ID and secret.

**2. Turn it on** in `.env`:

```
FACEBOOK_APP_ID=…
FACEBOOK_APP_SECRET=…
TOKEN_KEY=…            (the same one as for Instagram; set it once and never change it)
```

Then run `pm2 restart generator --update-env`. **Admin → Server** shows **Facebook posting: OK**. Agents see a **Facebook Page** panel in Brand.

**3. Test with your own Page** while the app is in development mode. Then send it for **App Review** with those three permissions before agents use it, the same way as Instagram (section F, step 4).

**How it posts.** Facebook downloads the video from the same signed, 3-hour link as Instagram. It's published as a Reel with the post text and, when the agent has a booking link, the video's tracking link. The app posts at most 10 Reels a day per Page; Facebook allows 30. If the agent changes their password or removes the app, posting pauses: you get an alert, and the agent sees **Reconnect** in Brand. A video sent back to review, or a Page that's disconnected, clears anything scheduled for it. If an agent manages several Pages, they pick one after logging in.

## AD. The shot plan and Studio's AI

**Nothing to set up.** The shot plan is on for every automatic video. Agents choose the mix in **Settings → Video → Footage mix** (More people, Balanced, More scenery) and can switch off kinds of shots under **Kinds of shots**. People shots always stay on, because the opening and the call to action need a face.

**How a plan is made.** Picked after everything else about the video (so the golden set's scripts don't change), per scene: the opening is a close-up or a medium shot of a person; the last scene shows a person; no kind repeats back to back or more than twice; at least 2 in 3, half, or 1 in 3 scenes show people, by the mix; and a kind used at the same spot in the last video is less likely. The plan goes into the script prompt as a **FOOTAGE PLAN**, so each scene's search names its kind of shot ("aerial neighborhood houses", "grandmother hands close up"). If nothing fits, a place or object shot falls back to its own kind of search, not to people. The plan is kept with the video, so **Fix a scene** finds the same kind of shot.

**Searches the agent types** (Studio, Fix a scene, Test footage) aren't held to any footage rule, and the clip check scores them on what they ask for, with or without people.

**✦ Ideas and the Studio coach** count toward the coach's daily limit and the AI spend cap, like other coach questions. Everything they offer is checked before it's shown: a line or a whole draft must pass the same checks as the board, an opening the same checks as Write 8 openings, and a fact to teach must be a confirmed fact for that worry. New facts start unconfirmed.

## AE. Smart Content: links and the fit check

**Nothing to set up.** Automatic links, the fit check, Link everything and ✦ Generate count toward the coach's daily limit and the AI spend cap.

**How links are judged.** Each link (worry → audience, fact → worry, solution → fact) gets a score from 1 to 5 with a reason, from a quick AI check that only judges whether the two belong together, never whether a fact is true. 4–5 fits, 3 is loose (a warning; videos still use it), 1–2 doesn't fit (videos leave it out). The verdict is saved with the content and tied to both texts, so editing either one sends that link back for a new check after the next save (up to 75 links per check; the rest are checked on the next save or with **Check links**).

**Product lines.** Starter content and generated facts and solutions carry a product line (final expense, mortgage protection, family protection). A fact or solution from one product line linked to one from another is blocked straight away. Audiences and worries can serve several product lines, so their links are only judged by the fit check.

**Overrides.** A blocked link can be used anyway with a reason. The reason shows under the link and the override is in **Admin → Activity** (`facts.override`). Removing the link and adding it back clears it.



## AF. The Mindset tab

**Nothing to set up.** The persuasion lens on each video is one small AI call (the quick model, `OPENAI_QUICK_MODEL`, default gpt-4o-mini), made while the footage is found; it's off with **Mindset → Persuasion lens → Show which principles each video uses**. The lens tool, 80/20 advice and the coach count toward the coach's daily limit and the AI spend cap.

**Where it's kept.** The parts that shape videos (the why, the hedgehog, objections, the lens and give-to-ask switches) are in the workspace's settings (`mindset` in config.json). Everything else (habits and check-offs, principles done, practice log, audits, strategy board, closer check, rival, reflections) is in `mindset.json`, and the client list in `clients.json`, in the workspace's folder. All three are in the agent's data download and are deleted with the workspace.

**Client notes are personal information.** Relationship notes hold what agents choose to write about their clients. They stay in the agent's workspace, aren't sent to the AI except when the agent picks that client in Reply to a message, and are covered by your Privacy Policy like the rest of the agent's data (section K).

## AG. Notifications, memory and the week ahead

**Notifications (Web Push).** Nothing to sign up for: the server makes its own key pair the first time it's needed and keeps it in `data/push-vapid.json` (it's in your backups; don't share it). To keep the same key on another server, set `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY` (base64url) in `.env`; if the key ever changes, agents just turn notifications on again. The site must be served over HTTPS (it already is behind nginx with a certificate). The server only ever sends to the browsers' own push services (Google, Mozilla, Apple, Microsoft), so nginx and your firewall need outbound HTTPS, which they already allow for OpenAI. On iPhone and iPad, agents first add the app to their Home Screen (Share → Add to Home Screen) and turn notifications on from there.

**Where it's kept.** Each workspace's devices are in `push.json`, what the app has learned (tracks and openings turned down, milestones seen) in `memory.json`, both in the workspace's folder and deleted with it. The data download includes the memory and how many devices are on. Logging out turns notifications off for that browser.

**The week ahead** reads the posting plan (Brand → Posting plan) and, without one, the "Post N reels this week" habit in Mindset (3 if there isn't one). Nothing to set up.

## AH. Days off, outages and offline review

**Outages.** When OpenAI or the stock footage sites don't answer (after their own retries), a video waits and tries again instead of failing: every `OUTAGE_WAIT_MIN` minutes (default 10), up to 6 times, without using up its one retry. The agent sees "OpenAI isn't answering right now. Going again at 3:40." You still get an alert if it finally fails.

**Offline review** uses the same service worker as notifications (`/sw.js`). The app's own files are kept so it opens with no connection; the agent's videos and lists are kept only after they tap **Save for offline**, and logging out clears them. Video files are stored in the browser (a few MB each, only the ones waiting for review).

**Errors.** Messages written for agents pass through as before. Anything that reads like the inside of the code (file paths, "Cannot read properties…", FFmpeg output) is replaced by "Something went wrong on our side." The real text stays in the server log, the job's log and your alerts.

**Export receipts** are emailed when email is set up (section L), and the last one shows in Account.

## AI. Roles, memberships and portals

**Roles.** `owner` is the agent whose workspace it is; `assistant` is a helper (paid seats, section AJ); admins (you) can do everything in any workspace they open from Admin. What each role can do is in `lib/roles.js` (`ROLES`), and what each workspace route needs is in `server.js` (`ROUTE_CAPS`); a test fails if a new route that changes something doesn't say what it needs.

**Done for you.** Turning **Done for you** on for a workspace in Admin (or the `MANAGED_PLAN` plan) switches its agent to the managed portal: they can't change content, brand, voice or settings themselves (their first setup is the exception), and ask you instead. Requests are kept in the workspace's `requests.json`; open ones show at the top of Admin and as alerts.

**Older accounts** keep working: a login with only a workspace is read as that workspace's owner. Deleting a workspace removes its logins, except people who also belong to another workspace: they keep their login and lose only that membership.

## AJ. Assistant seats and the Desk

**Seats with billing on.** Create a recurring per-seat price in Stripe (for example $29 a month) and set its id as `STRIPE_PRICE_SEAT` in `.env` (and `STRIPE_PRICE_SEAT_YEARLY` for agents on yearly plans: Stripe bills everything on one subscription on the same schedule). Agents add and remove seats themselves under **People**; each change updates their subscription's quantity (Stripe prorates it) and the webhook keeps it in step. Seats in use can't be removed (remove the assistant first). Without the seat price, agents ask you for seats.

**Invites and seats.** Every assistant gets an invite link, including people who already have a login (they log in, open the link and tap Join): nobody is added to a workspace without saying yes. An invite holds a seat until it's accepted or taken back; sending it again replaces the old link. If seats drop below the number of assistants (you lower them, or the plan ends), the newest assistants are paused until there's a seat again. Removing an assistant who works nowhere else removes their login, so they can be invited again later.

**Seats without billing, or for comped workspaces.** In Admin, a workspace's **Assistant seats you give** sets how many it has (0–10). With billing on, those add to any it pays for.

**Two-factor for assistants.** With the default `TWO_FACTOR=admins`, assistants must set up two-factor login too (they work with someone else's clients). `TWO_FACTOR=off` turns that off for everyone (not recommended).

**Where it's kept.** Handoffs are in each workspace's `handoffs.json`; leads live with clients in `clients.json` (with their stage, next follow-up, birthday and policy date). Both are in the data download and deleted with the workspace.

## AK. The engine: damaged files, the watchdog, Instagram checks and AI ladders

**Damaged files.** Every save keeps the document's previous version (`<file>.prev` next to it; with SQLite, in the database). When a document can't be read, the app restores the previous version, or the newest nightly or pre-update backup that has a good copy, and alerts you with what was restored ("its previous save (the latest change to it may be missing)"). The damaged copy is kept in `data/damaged/` (the app never deletes it). If no good copy exists anywhere, the alert says so; pages that need that file show "Some saved data couldn't be read" and nothing is written over it. To restore it from a backup by hand:

```
mkdir -p /root/restore && tar -xzf /root/generator/backups/data-2026-10-15.tar.gz -C /root/restore
cp /root/restore/workspaces/<id>/videos.json /root/generator/data/workspaces/<id>/videos.json
```

(Off-site copies: `node admin.js decrypt-backup` first, section Q.) The previous copies are deleted with the data they belong to, and otherwise follow the same retention as backups.

**The watchdog.** A video that shows no progress (no step finished and no FFmpeg output) for `JOB_IDLE_MINUTES` (default 12), or runs longer than `JOB_MAX_MINUTES` (default 40), is stopped along with every program it started. It goes back in line with its finished stages kept (its one retry), and you get an alert ("A video got stuck, so it was stopped…"). Every FFmpeg run also has its own limit (the render: 10 seconds per second of video, at least 5 minutes; `RENDER_TIMEOUT_MIN` overrides). The old "rendering for too long" alert stays as a backstop (`JOB_STUCK_MINUTES`, default 55).

**Resuming.** Each video job keeps its finished stages in `data/work/job-<id>/` until it's done or has failed for good. A restart keeps the folders of videos still in line. The review card shows the total AI cost of all tries.

**Instagram.** Posting goes: container made → Instagram processes it → **publishing** (saved first) → posted. A container can only be published once, so asking again is safe. When Instagram doesn't answer, the next minute checks the container and the account's latest posts. "Didn't go out" is only said when Instagram reports an error. After 30 minutes without an answer mid-publish, the video shows **We couldn't confirm whether this went out**: the agent checks the account and taps **Mark posted**, or posts again (which checks first and won't post twice).

**AI ladders.** Each AI job (writing, openings, ranking, the coach, quick checks, footage checks, voiceovers, voice timing) tries its models in order:

| Job | First choice (your .env, as before) | Backups |
|---|---|---|
| Writing, openings, ranking, coach | `OPENAI_MODEL` etc. (default `gpt-4o`) | `gpt-6-luna`, then Claude Sonnet (`claude-sonnet-5-5`) |
| Quick checks, footage checks | `OPENAI_QUICK_MODEL` / `OPENAI_VISION_MODEL` (default `gpt-4o-mini`) | `gpt-6-luna`, then Claude Haiku (`claude-haiku-5-5`) |
| Voiceovers | `OPENAI_TTS_MODEL` (default `gpt-4o-mini-tts`) | `tts-1`, then ElevenLabs |
| Voice timing | `OPENAI_TRANSCRIBE_MODEL` (default `whisper-1`) | none (ElevenLabs times its own words; otherwise pauses in the voice are used) |

- **A retired model** (the company says it doesn't exist) is skipped for a day and you're alerted once.
- **An outage, an empty account or a rejected key** moves the call to the next model from a *different* company (another OpenAI model would be down too). With no other company set up, the video waits out the outage as before.
- **A setting a model refuses** (newer models refuse `temperature`, or want `max_completion_tokens`) is dropped for that model, and the call goes again.
- **Every day** the app asks each company about every model on every ladder. You're warned when a first-choice model is due to shut down within 90 days, with what will replace it.

Replace a ladder with `AI_LADDER_<JOB>` in `.env`, for example `AI_LADDER_WRITER=gpt-6-luna,anthropic:claude-sonnet-5-5`. Jobs: `WRITER HOOKS CRITIC COACH QUICK VISION VOICE TIMING`.

**What to do about OpenAI's 2027 shutdowns.**
1. **Writing:** when you're ready, compare the new model on your own content with the golden set (section X): `OPENAI_MODEL=gpt-6-luna node admin.js golden <workspaceId> --label luna`, then `node admin.js golden-compare`. If you like it, set `OPENAI_MODEL=gpt-6-luna` (and the quick and vision models). If you do nothing, the ladder moves to it on January 14, 2027.
2. **Voiceovers:** before January 6, 2027, add a second voice company. Create an ElevenLabs account, pick a voice in its voice library, and set `ELEVENLABS_API_KEY` and `ELEVENLABS_VOICE_ID` (and `ELEVENLABS_VOICES` to give each Brand voice its own). Listen to a few videos made with it before the date. Until it's set, voiceover videos will fail after January 6; caption videos aren't affected.
3. **A second company for writing (recommended):** set `ANTHROPIC_API_KEY` so an OpenAI outage doesn't stop videos.
4. Run `node admin.js models` to see the result.

## AL. Data safety and the video line

**Saved documents** are written to a temporary file that's forced onto the disk, then renamed over the old one, and the folder is synced. A power cut leaves either the old document or the new one, never half of one. (`DURABLE=off` turns the syncing off; don't, on a real server.)

**SQLite is the standard from 15.** A fresh install starts on it. An update moves a JSON-files server into it once: `update.sh` stops the app, runs `node admin.js storage auto` (every document copied and read back; the JSON files kept in `data/json-before-sqlite-<date>/`), then starts it. If the move fails, nothing is lost and the app keeps running on files. Going back is `pm2 stop generator && node admin.js storage rollback && pm2 start generator` (section T). Set `STAY_ON_JSON=1` in `.env` to stay on files.

**The nightly inspection** runs after the nightly cleanup. It fixes:
- video files and covers that no video has, a day old or more (a crash between rendering and saving);
- the folders of deleted workspaces;
- videos whose file is gone (marked "file removed");
- logins' memberships in deleted workspaces;
- videos in line for deleted workspaces.

It lists for you:
- documents it couldn't repair;
- the database's own check;
- videos waiting for review that lost their file;
- logins that belong to no workspace;
- more assistants than seats;
- handoffs about deleted clients or videos.

The last report is in `data/maintenance.json` (`inspection`). Run it any time with `node admin.js inspect` (`--dry-run` to see without fixing).

**Record shapes** (`lib/shapes.js`): videos, workspaces, logins, clients and handoffs are checked against their declared shape when saved. On your server a wrong shape is saved anyway and you get one alert a day naming the problem and where it came from (that's a bug to report). In the checks it fails the build.

**The disk reserve.** No new video starts while free space is under `DISK_RESERVE_GB` (default 1.5). When that happens, the caches and old work folders are cleared at once and you're alerted (at most every 10 minutes). Videos in line show "Paused: the server is nearly out of disk space" and start by themselves once there's room. The 3 GB warning (`LOW_DISK_GB`) still comes first.

**Restarts.** pm2 gives the app 1.6 seconds to stop. That's enough to hand a running video back, so it doesn't use up its try and resumes from its last finished step. A video that's mid-render loses only the render itself.

**Leases.** Each running video holds a lease (`LEASE_SECONDS`, default 90), renewed every couple of seconds. If its worker dies, the video goes back in line once the lease runs out. On the same machine that happens at once: a dead process is noticed right away.

**A separate video worker** (needs SQLite):
```
cd /root/generator
echo 'WORKER_MODE=separate' >> .env
pm2 restart generator --update-env
pm2 start worker.js --name generator-worker && pm2 save
```
The website then only puts videos in line; `generator-worker` makes them. `update.sh` restarts both. Its log is `pm2 logs generator-worker`. A second worker on a bigger server can share the database: run it with the same `data/` folder (a shared disk). Set `WORKERS` to how many you run, so the night-capacity check counts them. `WORKER_JOBS` (default 1) lets one worker make several videos at once on a server with many CPUs.

**Night capacity.** Each night the app adds up everyone's overnight top-up, times how long a video takes here (the median of recent ones). If that needs more than 4 of the 5 overnight hours with your workers, you're alerted, with the numbers. The last result is in `data/maintenance.json` (`nightCapacity`).

## AM. Breakers, limp modes, the switchboard, the outbox and one-time keys

**Breakers** (`lib/breaker.js`). Only "the service is down" failures count: no answer, a timeout, a 429 or a 5xx. A refused request (a bad address, a wrong setting) doesn't. After `BREAKER_FAILURES` (5) in a row, the breaker opens for `BREAKER_COOL_SECONDS` (60). Then one trial call goes through: if it works, the breaker closes; if not, it stays open twice as long, up to 15 minutes. State is kept in `data/breakers.json`, so a separate worker and the website agree. Admin → Switchboard shows any open breaker and the last error. You get an alert when one opens and when the service answers again.

**Limp modes:**
- **AI:** the next company on the ladder (section AK).
- **Footage:** Pexels alone while Pixabay is down (set `PEXELS_API_KEY`).
- **Instagram and Facebook:** scheduled posts wait, and nothing counts against them. A post already publishing keeps being checked, as in section AK.
- **Stripe:** billing pages say "Payments aren't answering right now".
- **After the same service has failed three tries in a row (about 20 minutes):** a video is made anyway rather than waiting more. The count is kept per stage (voice, footage), so an outage of a different service doesn't count. `LIMP_AFTER_TRIES` changes the number. With the voice service still down, it's captions only. With both stock sites down, it uses the agent's own clips, if they have one for every scene. Its review card says which, so the agent can approve it or make it again later.

**The switchboard** (Admin, top):

| Switch | While it's off |
|---|---|
| Making videos | New videos are refused with "paused for maintenance"; the line keeps what's in it and starts again when it's back |
| Overnight videos and plans | Overnight top-ups, the Monday plan and posting-plan refills don't run |
| Posting to Instagram and Facebook | Scheduled posts wait |
| The coach and AI helpers | Answers "paused for maintenance" |
| Emails | Held in the outbox up to 3 days |
| Phone notifications | Skipped |

Each workspace card has the same switches for that workspace alone. Every change is in the activity log with your note.

**The outbox** (`lib/outbox.js`, `data/outbox.json`). Emails and phone notifications are sent at once when possible. Otherwise they're kept and sent again (1, 5, 30 minutes, then 2 and 6 hours) until they go or expire: 3 days for an email, 15 minutes for a notification. Each carries a one-time key: the weekly review reminder, for example, is keyed by workspace and date, so it never goes twice. Refused messages (a bad address) alert you as before. Admin → Switchboard → Outbox lists recent messages, with **Send now**.

**One-time keys.** Every change the portal sends carries an `Idempotency-Key`. The same key from the same person within 10 minutes gets the first answer, marked `Idempotent-Replay: true`, without doing it again. A double tap while the first is still on its way reuses its key, and a decision saved offline keeps its own. Changes sent to Stripe carry Stripe's own one-time key; when the connection drops before Stripe answers, the same change is sent once more with the same key.

## AN. The Engine bay, the flight recorder, targets, the clock and the reference render

**The Engine bay** (Admin, under the Switchboard; `node admin.js engine` in the terminal):

| Part | What it shows |
|---|---|
| Targets | Each target with its light (below) |
| The line | What's making, waiting, waiting out an outage, or held; the last 7 days' videos, and each step's typical time and the time 95% finish within |
| Outside services | Each breaker, how many calls answered or failed in 24 hours, and the average time of each service inside videos |
| Processes | Memory and event-loop lag of the website and of a separate worker, now and their worst hour today |
| Disk and backups | Free space, GB used a day over the last 30 days and when the disk would be full; the last backup, off-site copy, restore test, inspection and reference render |
| Build and clock | Node, FFmpeg, storage and where videos are made; the last clock check (**Check now**) |
| Recent runs | The last 15 runs with their step times; **Timeline** shows every step and service call in order |

Numbers come from `data/flight.json` (one line per run, the newest 2,000), `data/timelines.json` (the full timeline of the newest 300 runs; the job itself keeps only its step times) and `data/gauges.json` (each process adds its counts once a minute: 14 days by hour, 120 days of disk). Both are in the backups and need nothing set up.

**Targets:**

| Target | Green | Yellow |
|---|---|---|
| Overnight videos ready by 7am (their time) | 99% | 95% |
| Double posts (posts left "unsure", the only way one can happen) | 0 | – |
| Videos made without failing (after retries) | 98% | 95% |
| Time to make a video, 95% within | 15 min | 25 min |
| Backup age | 26 h | 36 h |
| Last restore test (with off-site backups) | 8 days | 14 days |
| Messages that gave up (7 days) | 0 | 2 |
| Days until the disk is full | 60 | 14 |
| Clock | 2 s | 10 s |
| Event-loop lag, worst hour | 100 ms | 500 ms |

Grey means not enough to measure yet (fewer than 5 videos, say). A red light sends one alert, with what to do; it's repeated when its number changes, or once a week while it stays the same.

**Alerts.** Every warning and error has three parts: what happened, **Already done** (what the app did about it), and **Left for you** (a command to paste, or a step; "nothing" when it's handled). Admin shows all three; phone pushes, Slack and Discord get them as three lines. The checks fail if a new alert in the code doesn't say what was done.

**The clock check** (`lib/clock.js`). Daily, and a minute after the server starts, the server's time is compared with `CLOCK_CHECK_URL` (default Cloudflare's trace page, which states the time to the millisecond; any page works, using its `Date` header, to the second). More than 5 seconds off is a warning; more than 30 (two-factor codes start failing) an error. The fix: `timedatectl set-ntp true && timedatectl status`. `node admin.js clock` checks now.

**The reference render** (`lib/reference.js`). Each night, after the backup, a 4-scene test video (FFmpeg's own test patterns, no AI, no outside services) is rendered with the real FFmpeg and fonts and compared with the first one: the picture at five moments, the length, size, frame rate and codec. A difference sends one alert, saying what changed since (FFmpeg's version, the app's version or its render code, or neither: then it's the fonts or the operating system). Watch `data/reference/latest.mp4` next to `reference.mp4`; if the new one looks right (you updated FFmpeg on purpose), run `node admin.js reference --accept`. A render that fails outright is an error alert: agents' videos are likely failing the same way. `REFERENCE_RENDER=off` turns it off; `REFERENCE_LIMIT` (6) is how much the picture may differ (an average, 0–255).

**A full disk.** A save refused for lack of space changes nothing (saves are all or nothing), the agent sees "The server is out of disk space, so this couldn't be saved. Nothing was changed.", and you get an alert. If the alert itself can't be saved, it still goes to your phone (`ALERT_WEBHOOK_URL`) and the log.

**The test rig** (for developers; `npm test`, `npm run test:full`, `npm run test:coverage`):
- `test/v15-crash.test.js`: the app is killed (SIGKILL) at each crash point in `lib/faults.js` (`CRASH_POINTS`): after the script, after voice and footage, after the render, after saving, after a fix's render, and at each step of posting to Instagram and Facebook. It's restarted and checked: one post, one video, one usage count, records and files matching. Making and fixing render real videos, so they run in `test:full`.
- `test/v15-rig.test.js`: fault injection (services slow, down, cut off or sending nonsense; `FAULTS=enospc` for a full disk; a damaged file; a frozen FFmpeg), the gauges, targets, the clock check, the Engine bay and the reference render.
- `test/v15-time.test.js`: every agent time zone, ticked every 10 minutes through the clock changes, month and year ends and a leap day.
- `test/v15-soak.test.js`: five years of data (about 1,040 videos and 250 clients per agent; 8 agents in `npm test`, 50 in `test:full` or with `SOAK_AGENTS=50`), with time budgets for every agent screen, admin screen and nightly job.
- `npm run test:coverage`: Node's own coverage; it fails if coverage drops below `test/coverage-floor.json`, and raises the floor when it goes up (commit the file).

Crash points and faults only work under the checks (`NODE_ENV=test`, or `FAULTS_ALLOWED=1` for a rehearsal on a spare server). On a real server they do nothing.

## AO. Built for 300,000 miles: aging well

**The expiry calendar** (`lib/expiry.js`; Admin → Engine bay, `node admin.js calendar`). Everything with a date, soonest first, with one alert at 90, 30 and 7 days (each once, per date):

| Item | Where the date comes from | What to do |
|---|---|---|
| Node.js | Node's published schedule (22 ends April 30, 2027; 24 April 30, 2028; 26 April 30, 2029) | Test the next version on a spare server, then move (below) |
| Meta's API version | `INSTAGRAM_API_VERSION` / `FACEBOOK_API_VERSION` (v25.0 ends July 29, 2028; after that Meta quietly answers with the next version) | Set the next version on a spare server, test posting, then switch |
| AI models | The companies' shutdown dates (read daily, section AK) | The app moves on by itself; choose the replacement yourself if you prefer |
| Instagram connections | Each agent's connection, when it isn't renewing itself (under 15 days left) | The agent connects again in Brand |
| Cards on file | Each paying agent's card, from Stripe (when they pay, and daily for cards ending within 60 days) | The agent updates their card in Billing |
| HTTPS certificate | Your site's certificate (`PUBLIC_URL`), checked daily | It should renew itself: `certbot renew --dry-run` |

Moving Node: on a spare server (or a copy), install the next version (`nvm install 24` or your package manager), run `npm test` in the app folder, start it on another port with a copy of `data/`, look around, then do the same on the live server and `pm2 restart generator`.

**The yearly archive** (`lib/store.js`). Finished videos over a year old (posted or approved, their file already cleaned up, nothing still happening to them) move out of `videos.json` into `videos-<year>.json`, by the year they were made, during the nightly cleanup (`ARCHIVE_AFTER_DAYS`, 365). The file every screen and every posting tick reads stays the size of a year, however long an agent has been here. The approval records (CSV and page), each video's receipt, the data download, old tracking links and the all-time counts read the archive too: nothing disappears. Reads are cached until the file changes, so the minute ticks no longer parse every agent's list every minute.

**Versioned keys** (`lib/secrets.js`). Two-factor keys and Instagram and Facebook tokens are sealed with the app's key (`.app-key`, or `APP_KEY` in `.env`), and each sealed value names the key that sealed it. Instagram and Facebook tokens used to be sealed with a key made from the Meta app secret: they still open, and move onto the app's key as they renew (Instagram every few weeks), or all at once when you choose: `node admin.js rotate-key --reseal`. Once moved, changing your Meta app secret no longer disconnects everyone. (Nothing is sealed the new way while an update is being checked, so going back to version 14 straight after updating finds everything as it was; after 15 has run for a while, going back means agents whose connection renewed connect again.) To change the key:

```
node admin.js rotate-key && pm2 restart generator
```

The old key is kept in `.app-key.old`, so nothing it sealed is lost, and everything is sealed again with the new one. Keep both files with your `.env` backup. With `APP_KEY` in `.env`, the command tells you the new value and to keep the old one in `APP_KEY_OLD`. A running server picks up a changed key by itself; a token it can't open because its key is missing (not because the connection broke) is left alone, never marked "reconnect".

**The key check.** At start, the server reads back a known value it sealed (`data/key-canary.json`). If it can't, its key doesn't match its data (usually a server restored without its `.app-key`): you get one plain alert, the health check shows `keys: false`, and nothing sealed is overwritten. Put the `.app-key` back and restart.

**Fonts ship with the app.** The caption fonts (Poppins, with its licence, `OFL.txt`) are in `assets/fonts/`, and every font file is checked against its SHA-256 when it's used and when the server starts; a damaged one is put back from the release. `Poppins-Bold.ttf` stays in your app folder as before (it isn't in the zip). If a font is missing everywhere, it's fetched from Google Fonts at the exact version the app was tested with and checked, never "whatever is newest". **Music** is yours (it doesn't ship with the app): each track's SHA-256 is noted the first time it's seen (`data/music.json`), and a track whose bytes change later is reported once.

**Numbered data changes** (`lib/changes.js`, `node admin.js changes`). Every change an update makes to stored data is a numbered step, run once, in order, when the server starts, and recorded in `data/changes.json` (for the server, and for each workspace it touched). A step only ever adds (so going back a version still reads the data), and can run again safely. The site answers at once while they run (its health check says `"starting": true` until they're done). A workspace a step can't touch (a damaged file) is skipped and listed, not a reason to stop. A step that fails outright is recorded, the ones after it wait, the server still starts, you're alerted, and the health check shows `changes: false`, which stops an update before it goes live (below). Version 15 itself has none: the yearly archive happens in the nightly cleanup, and resealing secrets is your choice (`rotate-key --reseal`), so nothing version 14 couldn't read is written while an update is being checked.

**The portal stays in step with the server.** Every answer from the server names its version. A portal tab left open across an update notices, says "A new version of the app is ready", and refreshes itself at the next calm moment (moving to another screen, coming back to the tab, or a minute with nothing being typed or sent), never in the middle of a change. What was being typed on that screen is kept and put back after the refresh.

**The build sheet.** Every release zip has a `BUILD.json`: the SHA-256 of every file, the checks it passed, and the Node and FFmpeg versions it was certified on. `update.sh` checks every file against it before anything changes, and refuses a zip that doesn't match (a damaged download, a file changed by hand) or has no sheet. `node tools/build-sheet.mjs verify <folder>` checks one yourself.

**The try-out on a copy.** Before a new version goes live, `update.sh` starts it on a spare port (`REHEARSAL_PORT`, 3199) against a copy of your data from the backup it just made, with its own empty fonts and music folders and nothing sent out (no posting, emails or overnight work). Its data changes run on the copy first, and it waits for them. If it doesn't start, or a data change fails there, the update stops and the live site is never touched. However the update ends (even Ctrl-C), the try-out is stopped and its copy removed. If `APP_KEY` is set only in pm2 (not in `.env`), put it in `.env` too so the try-out can read the data.

**Side-by-side releases (optional, once).** Each version can live in its own folder, with `current` pointing at the live one:

```
cd /root/generator && bash update.sh --use-releases
```

This moves the app's own files (the ones its build sheet lists) into `releases/<version>/`; everything else in the folder (your data, videos, backups, `.env`, `.app-key`, fonts, music, `Poppins-Bold.ttf`, `prompts/`, and anything of your own) stays where it is. It leaves small starters, so `pm2`, `node admin.js …` and `bash update.sh …` work as before. It needs an install from a version 15 zip (one with `BUILD.json`). From then on:

- `bash update.sh /root/update.zip` unpacks the new version next to the live one, checks its build sheet, runs its checks, tries it on a copy of your data, then switches `current` in one step. The live version is never touched until the switch.
- `bash update.sh --rollback` switches back to the version before, instantly. (Data changes only ever add, so the earlier version reads the data fine.) A new version that doesn't come up after the switch is switched back by itself, and the way back stays as it was.
- The live release, the one before, and one more are kept.
- Updates come from zips (not `git pull`).

Moving back to one folder: `pm2 stop generator`, copy `releases/<version>/*` into the app folder, remove `current` and `releases/`, `pm2 start generator`.

**Standard mounts** (`lib/plugins.js`). Posting platforms (Instagram, Facebook), stock-footage sources (Pixabay, Pexels) and niches (life insurance) plug in the same way: each kind has a declared shape, checked when it's registered, and a test kit in `test/kits/` every part of that kind must pass. TikTok, YouTube Shorts and real estate (phase 9) arrive as one more part each.

**The code, by area.** `server.js` keeps the engine (sign-in, the job line, the one list of route capabilities, start-up and shutdown); its routes are in `routes/` by area (account, setup, scripts, studio, videos, admin…). The portal's screens are in `public/screens/` (one file per screen); `public/app.js` keeps the shell, the router and the shared parts.

## AP. Finishing touches and smoothness

**How a video is finished** (`stages/craft.js` measures; `stages/render.js` applies). All of it runs on your server with FFmpeg; only the second look uses the AI.

- **Sound.** The voice and music are mixed on their own first (each line with a 12 ms fade in and 30 ms fade out, a high-pass at 70 Hz, a gentle compressor; the music faded in over 0.8 s and out over 2 s, ducking under the voice). The mix is measured (integrated loudness and true peak), then raised or lowered to -14 LUFS in one exact gain. If that gain would push a peak past -1.5 dBTP, a fast limiter (FFmpeg 4.4 or later) catches just those peaks, and the loudness it takes is measured and put back (up to three rounds; very spiky sound may end a little under -14, as loud as it can be without distorting). On an older FFmpeg, the two-pass leveler does it. Video is encoded without B-frames, so picture and sound start together. The last quarter second fades out, so the loop back to the start doesn't click.
- **Safe zones.** The captions are played over black at a tenth of the size, every frame at 30 a second (under a second for a minute of video), and any lit text in these zones is noted: the top 200 px (header), below y=1540 (name, post text, audio line), x ≥ 960 between y=1040 and 1540 (the buttons), and the outer 32 px. A scene caption (or the end card) that strays in is made 10% smaller, up to three times. What's still in a zone after that is on the review card ("Shorten it with Fix a scene"; for the end card, "Shorten your name, title or call to action in Brand"). The check reads every word as white, so a dark accent color can't hide from it. The end card's small print is sized by its length, to three lines at most.
- **Footage.** Each clip is sampled 4 times a second: its brightness and color (for evening out, at most ±8% brightness and ±5% color, toward the group's middle), how bright the caption area is (a stronger shadow from 145, strongest from 185, out of 255), and where a fade-in from black ends (skipped if it's within the first 1.5 s, and only as far as the clip is long enough not to loop back into the fade before the scene ends).
- **The beat.** Every tempo from 70 to 180 BPM, and every starting point, is tried against the track's onsets; a track with no steady beat is left alone. Each track's beat is worked out once and remembered (`data/beats.json`). A cut moves to a beat within 0.4 s later, or earlier only as far as the spoken line (or the shortest scene) allows, and never pushes a video past a minute. Scenes are whole frames (30 a second), so a cut lands exactly on its beat.
- **The loop.** The last 0.4 s cross-fade back to scene 1's first frame, with its caption fading in.
- **The second look.** One frame from the middle of each scene, with its caption, in one AI call (the vision model, at low detail: a fraction of a cent per video, counted in the AI spend cap). Only clear problems are named. `SECOND_LOOK=off` in `.env` turns it off for everyone; it's also off for a workspace whose AI clip check is off. If the AI can't be reached, the review card says the second look couldn't run.
- **Switching a part off for one workspace.** In its config's `look`, set `match`, `beat`, `loop`, `shadow`, `opening` or `safezones` to `"off"`. (They're all on by default; there's nothing to set.)
- **The nightly reference render** now includes `stages/craft.js` in its "render code" fingerprint, so the first night after this update it notes that the render changed on purpose (no action needed; `node admin.js reference --accept` if it asks).

**Smoothness in the portal.**

- **Preloading** keeps at most three videos on the device (in the browser's preload cache), only ones still waiting for review, and fetches nothing on a data saver or a 2G connection. Logging out clears it.
- **Notifications** carry the video's link (`#/review/<id>`); an open portal switches to it without reloading.
- **The portal's files** are sent compressed (gzip) with an ETag, so a browser that has the current copy is told so (304) instead of downloading it again. Behind nginx this works as is (nginx passes compressed answers through).
- **Undo**: a deletion or rejection waits 10 seconds for Undo before it's sent; if the page is hidden or closed first, it's sent at once.

## AQ. Studio's checks, render rules, review and the clip picker

**The three kinds.** Every check returns findings: `{ rule, kind, scene, text, fix }`. `kind` is `stop` (a render waits for it), `warn` (a note) or `fix` (the app applied it). Each rule is in `mixer-core.js` (`RULES`), so the server and the portal check with the same code.

| Rule | In drafts | In automatic videos |
|---|---|---|
| Prices, percentages and price comparisons; rate and urgency wording; numbers or ages the facts don't have; saying the viewer will qualify; government wording; absolute claims; a dropped qualifier; banned phrases; wording the agent requires; unconfirmed facts; a caption in every scene | stop (locked) | stop (locked) |
| Overused ad wording; the highlighted word; word limits; too close to a recent video; where questions go; the call to action; emoji and hashtags; exclamation marks | warn | block |
| Footage search rules | off | block |
| Teaching scenes say the fact | warn | off |
| Style fit and reading level; another product or audience | warn | warn |
| Spelling | warn | off |

"Drafts" are Studio and Fix a scene (anything a person wrote); automatic videos are the ones the AI writes, which are written again when a check blocks them. A note in a draft travels with the video to its review card ("Notes rendered past"), so the agent sees it before approving.

**Render rules** (Admin → Render rules, `data/render-rules.json`).
- **Levels:** each style rule, for drafts and for automatic videos: `block`, `warn` or `off`. Locked rules have no level to change.
- **Settings** (held to a safe range): how much of the fact the teaching scenes must say (0.3 to 0.8 of its key words, default 0.5); caption and spoken word limits (blank keeps the workspace's own setting); recent videos that count for "too close" (3 to 50, default 30).
- **Lists:** words added to or taken off the built-in overused phrases, abstract footage words, and words never highlighted. The built-in lists still update with new versions.
- **For everyone or one workspace.** A workspace's own rules sit on top of everyone's. **Try it first** checks a pasted script (one line per scene) or a recent video with the rules on screen, saved or not. Each save is recorded (who, when, before and after, the last 100), in the audit log too; **Undo this change** or **Back to this version** restores any of them.

**Spelling** (`lib/spell.js`, dictionary `assets/words.txt`, licence `assets/words-LICENSE.txt`, plus a short list of insurance and everyday words in the file). Checks captions as the draft is checked, a note on the scene's card; corrections favor the likeliest word, and the one-tap correction changes only that word where it is. Not checked: capitalized words mid-sentence (names), the agent's own words (name, city, facts, worries, audiences), numbers, links and @handles. At most 6 notes a caption and 30 a request, and words of more than 10 letters are only corrected one letter away, so pasted junk can't slow the server.

**Open drafting and agent review.**
- **Submit for review** renders an assistant's draft into the agent's Review. The draft stays linked to the video, so the next submit replaces it as version 2, 3… up to 10 (`MAX_VERSIONS` in `routes/studio.js`; fixes don't count toward it); the old file is removed once the new one is saved. New versions don't count toward the month's videos, and a new version isn't checked as "too close" to the one it replaces. While one is being made, the video can't be approved or fixed; approving always names the version on screen, so a newer one is watched first.
- **Needs changes** (Studio videos only; for automatic videos, use Fix a scene) sends a checklist to the Desk, for the assistant who submitted it (or every assistant). Ticking an item in Studio ticks it on the Desk. It closes by itself when the new version is submitted, or when the agent approves the video; the agent can also **Withdraw** it on the Desk. Asking again replaces the earlier request; while a new version is being made, the agent asks on that version once it arrives.
- **The compliance receipt** (on an approved video's card) lists the locked checks the approved version was checked against (recorded on each render and fix from version 15 on; older videos don't claim them), the notes rendered past, and each version: who submitted it, which scenes changed, and the checklist it answered.

**The clip picker** (Fix a scene). "Show clips" searches the scene's footage words: up to 10 clips (`PICKER_SIZE`), scored by the clip check (a clip scored 1, unusable, is left out; with the workspace's clip check off they come unscored), never one the video already uses. **Refresh** brings 10 more, up to 5 times per search and 15 lists per scene in all, for 6 hours or until the fix is sent. The clips offered, and their scores, are kept by the server: a fix can only pick one of them (after a restart, or 6 hours, tap Show clips again). A picked clip is used exactly (no search when it re-renders), and the review card says "You chose the footage in scene 3 (the clip check scored it too)". Previews play from Pixabay and Pexels, which the page's security policy allows for video.

**The persuasion lens** (Mindset). Flags quote the draft's own words (compared without punctuation or capitals; a quote shortened with "…" counts when its parts are there in order), and a flag whose words aren't in the draft is dropped. Urgency, scarcity and testimonials are pressure; fear or guilt is a gentle note. Its advice and sample lines pass the same checks as scripts before they're shown. The pressure words found in a video's script are shown on its review card.

## AR. Fitting the agent: the ready time, Away, the busy week, video pages, keepsakes and comfort

**The ready time** (`lib/chauffeur.js`). The time the agent usually reviews is learned from their approve and reject times over the last 60 days, in their time zone: at least 5 decisions on 3 different days, and at least half of them within one 3-hour stretch. The early edge of that stretch (rounded down to 15 minutes) is when they review; keep-ready videos are made in the window that ends 45 minutes before it and starts early enough for the number wanted (12 minutes a video plus 30, between 1½ and 5 hours, never before 12:30am). The stretch can run past midnight (11:40pm and 12:20am count together). Without a habit, or with one so early that the window would start before 12:30am, it's 1am to 6am, as before.

**Away** (Settings → Away, `POST /api/away {back}`, `DELETE /api/away`; up to 60 days). Starting it:
- **Fills the days you're gone** from the week's plan, or from what's already scheduled (each day says which), and schedules them for posting at the plan's time. Days it can't fill are listed before you start.
- **Tells the assistants**, with a note on their Desk.
- **Keeps the agent's phone quiet:** no review reminders, no pushes to the agent (assistants still get theirs), no proactive suggestions, and no keep-ready videos. Today counts it as a day off.

It ends on the back date or with **I'm back**; the welcome-back card counts what was posted, the link visits and new leads, the handoffs finished, the videos waiting for review and what's still scheduled. It goes once dismissed.

**The busy week** (`POST /api/busy-week`): up to 5 videos for the week's empty days, in one go (they use the month's videos as usual). One notification arrives when the last one finishes, and opens Review one by one (`#/review/focus`). **Coming up** (Review) lists what needs doing in the next 42 days: Instagram's connection running out, the card on file expiring, facts due for their check. In the morning, Today lists what was made or posted overnight.

**Video pages** (`lib/landing.js`). `https://<site>/r/<code>` opens a small page for an approved or posted video: "You watched:" with its opening line, the agent's photo, name, title and town, **Pick a time** (the booking link, counted as a booking click; `/r/<code>/book`) and a form (first name, phone or email, an optional question). The page has no scripts and no outside requests, under a strict security policy. A hidden field catches bots. One address can send 5 an hour (a whole IPv6 network counts as one address), the page takes at most 30 leads a day in all, sending the same form again (a refreshed thank-you page) doesn't make a second lead, and the last 200 places in the client list are left for the agent's own entries. A visitor only ever sees messages about their own form; anything else goes to the server log. A sent form adds a lead to the Desk (stage Lead, source "Video: …", the question in its notes, linked to the video), counts toward that video's results, and notifies the agent and assistants. **Brand → Your video pages:** a photo (`photo.jpg` in the workspace folder, made square, 400×400), and **Send people straight to the booking page** (`look.landing: 'direct'`, the old behavior). A link whose video was deleted or rejected, or whose workspace is suspended, shows "This link isn't active right now".

**Keepsakes** (`lib/keepsakes.js`, `keepsakes.json`). Kinds: birthday and welcome. Each is 2 to 4 caption lines of up to 60 characters (the defaults use the client's first name; held to the same rules as a reply to a client: no prices, percentages, government wording, promises or never-use words), the agent's own clips (a welcome needs at least one; a birthday without them uses warm stock footage), and the end card. No voice. They're made in the queue like any video, at most 12 a month (deleting one doesn't give it back), never posted, not counted in the month's videos, results or Review, and removed after 60 days. The Desk shows them with **Share** (the phone's share sheet), **Download** and delete; one deleted while it's being made just stops. Deleting a client deletes their keepsakes too.

**Notes** (`POST /api/clients/:id/note {kind}`): thanks, welcome, birthday, anniversary or check-in. Three drafts in the agent's voice (from their voice samples), checked like replies (no prices, no promises). The Desk's client care now includes a thank-you for 5 days after someone books and a welcome for 30 days after they move to Client from another stage (someone added straight in as a client isn't new, and neither is anyone from before this version).

**Comfort and privacy** (this device only, kept in the browser):
- **Bigger text** zooms the portal 1.15× and strengthens contrast. The phone's "increase contrast" setting is followed too.
- **Theme:** follow the phone; follow sunset (worked out from the agent's time zone, checked every 5 minutes); always light; or always dark.
- **Reduce motion:** when the phone asks for it, nothing scrolls smoothly.
- **The privacy curtain** (the eye in the header, for people who see clients) blurs client names, notes and messages until tapped again.

**Spoken times.** Times across the portal read as they're said, in the agent's time zone: "this morning at 9:05am", "yesterday at 4pm", "Tuesday at 9am", "last Tuesday", or a date further back.

**Milestones.** For a week after the agent's anniversary (from when they accepted the agreement), Today shows the year's numbers. After 5pm, it shows the day: approved, rejected, posted, leads, done and clicks, and what's ready for tomorrow.

**The simpler Studio start.** A new draft opens on the agent's worries ("1. What's this video about?"). Picking one fills the audience and the fact, and takes the format used least recently that needs nothing extra. One sentence says what's chosen, with **Change**, **Another worry**, **Teach something else** and **Surprise me** (a random format that fits, then the openings written). **More choices** opens the full panel; **Simpler view** closes it. A series shows on Create with how far along it is and **Continue** (the next part's title and format filled in).

**The save bar.** On Content, Brand and Settings it's as before. Elsewhere, unsaved changes from those pages say which page they're on, with **Go back to them**, **Discard** and **Save them**. A coach suggestion that's applied saves just that change at once, so nothing is left waiting unseen.

**Plan defaults.** New workspaces on Starter get 30 videos a month and Pro 60 (`PLAN_DEFAULT_VIDEOS` in `lib/billing.js`); Admin can still set any number per workspace.

**On the phone.** The box being typed in is kept clear of the on-screen keyboard and the save bar on every screen (the page gets room below the last box while the keyboard is open; scrolling yourself while typing is left alone). The Coach button and ready cards sit above the save bar at its real height, and a message rises above whatever is at the bottom.

No new settings in `.env`.

## AS. The compliance reviewer, bookings, keyword replies and opening tests

**The compliance reviewer** (`lib/signoff.js`, `routes/signoff.js`).
- **Who they are.** A role of their own (`reviewer`): only the Sign-off page, no assistant seat, at most 3 per workspace, two-factor login required (like assistants). The agent and admins can't sign off.
- **Setting it up.** The agent invites them in People → Compliance reviewer, and turns on sign-off once they've joined.
- **What waits.** With sign-off on, an approved video that isn't signed off for its current version and file waits:
  - Instagram and Facebook hold a scheduled post until it's signed off. It's held, not failed, so it may post later than its time.
  - The posting plan skips it, and Away fills days with signed-off videos.
  - The Download button and Mark posted are refused (the video still plays on its card).
- **The reviewer's decision.** Signing off is for that version only. Sending back needs a note, returns the video to the agent's Review (approval cleared, any scheduled post canceled) and shows the note on its card.
- **Notifications.** Reviewers get a push and an email when a video starts waiting, and when sign-off is turned on with videos already waiting. The agent gets a push for each decision.
- **The week ahead** and "running low" count a video waiting for sign-off as still in review, not ready to post.
- **Records.** The receipt lists every decision, and the records file has "Signed off by" columns.
- **Removing the last reviewer** turns sign-off off, so nothing is stuck.

**Bookings** (`lib/bookings.js`).
- **The link out.** `/r/<code>/book`, and a direct link when Brand says so, adds `utm_source=agentreels&utm_medium=video&utm_content=<code>` to the booking link. Cal.com links also get `metadata[ref]=<code>`.
- **Booking confirmations address.** In Brand → Booking link → Booking confirmations, each workspace has a private address: `https://<site>/hooks/booking/<token>`. **Make a new address** retires the old one.
- **What it accepts:**
  - Calendly (`invitee.created` / `invitee.canceled`; the code comes back in `tracking.utm_content`);
  - Cal.com (`BOOKING_CREATED`, `BOOKING_RESCHEDULED`, `BOOKING_CANCELLED`; the code in `metadata.ref`);
  - anything else, as JSON: `{ "event": "booked" | "canceled", "id", "name", "email", "phone", "start", "ref" }`.
- **Signing key (optional).** With one set, every call must be signed: Calendly's `Calendly-Webhook-Signature`, Cal.com's `X-Cal-Signature-256`, or `X-Signature` (hex HMAC-SHA256 of the body).
- **How a booking is handled:**
  - The same call twice is handled once. A Calendly reschedule (a cancel marked `rescheduled`, then a new booking) isn't counted as a cancel.
  - The person is matched by email or phone, preferring the lead from the same video. They're moved to "Appointment booked" (a client stays a client) with a note. Someone unknown is added (source "Booking: …" or "Booking page"), at most 50 new people a day this way, and never into the last 200 places of the client list (they're the agent's own).
  - The video counts the booking once per person (`video.bookings`), and the agent and assistants get a push.
  - A cancel moves them back to "Talking" and is counted once.
  - An address takes at most 120 calls an hour.
- **Calendly webhooks** need Calendly's API (paid plans) or Zapier. Cal.com has webhooks in its settings.

**Keyword replies on Instagram** (`lib/replies.js`, `routes/replies.js`).
1. In your Meta app (the one for Instagram, section F), add the permissions **`instagram_business_manage_messages`** and **`instagram_business_manage_comments`**, and request Advanced Access for them in App Review.
2. Meta app → Instagram → Webhooks:
   - callback URL `https://<your site>/hooks/instagram`;
   - verify token: any long random text;
   - subscribe to **messages** and **comments**.
3. Add to `.env`:
   ```
   INSTAGRAM_REPLIES=1
   INSTAGRAM_WEBHOOK_TOKEN=<the same verify token>
   ```
   Then restart.
4. Agents connect Instagram again once (Brand), to allow messages. The app then asks Instagram to send that account's comments and messages (`subscribed_apps`).

How it works:
- **Signed calls only.** Every call from Meta must carry `X-Hub-Signature-256` (the app secret). Others are refused.
- **What gets an answer.** A comment on any of the account's posts, or a message, that contains an approved keyword as a whole word (in a short message) gets the reply:
  - for a comment, as a private reply to the comment;
  - for a message, as a message back.
- **Placeholders.** `{name}` is their first name if Instagram shares it ("there" otherwise). `{link}` is the video's page (for a comment on a video the app posted) or the booking link.
- **The wording.** Replies are checked like the coach's reply drafts: no prices, percentages, government wording, promises or never-use words. The only links allowed are `{link}` and the booking link (a bare `bit.ly/…` or `site.com/…` counts as a link). The wording is checked again each time a reply is sent; one that no longer passes (a new never-use word, say) goes back to waiting for approval instead of being sent.
- **Approval.** The agent's own wording is approved as written. An assistant's waits for the agent, and an assistant changing an approved reply (its wording, keyword or where it answers) sends it back for approval.
- **Limits.**
  - Instagram's own: one private reply per comment, within 7 days; a message only in answer to theirs, within 24 hours.
  - This app's: each person hears from a keyword once a day, and a workspace sends at most 100 a day. These are counted on their own (`replies-count.json`), so they hold however busy a post gets; a refusal is logged once a day per person.
- **After a reply goes out.** The person becomes a lead on the Desk (once, by their Instagram id, and never into the last 200 places of the client list), tied to the video, and the agent and assistants get a push. Replies stop when the plan ends.
- **The log.** The last 300 sends and refusals are kept, and the last 40 are shown.
- **Switching off.** Admin → Switchboard → **Keyword replies** turns them off.

**Opening tests** (`lib/abtests.js`).
- **Starting one.** Studio's last step offers it on a new draft that passes the checks. Version B's opening is checked like any render, and the highlight moves with it. Both versions use one of the month's videos each, and at most 3 tests run at once.
- **The two versions.** Version A is the draft's video; B is its twin and leaves the draft alone. In a voiceover video, B's spoken line changes with its opening. Changes to B are made with Fix a scene (it has no draft of its own for Needs changes).
- **Deciding.** Once both are posted, the test waits 7 days, then compares views (from Instagram, or added by hand: a views field left empty isn't a result). A winner needs at least 20% more views than the other, and 100 views; anything closer is "too close to call".
- **Stopping.** A test stops if a version is rejected, deleted or never made (its job canceled or failed), or if views never come in within 21 days. It can also be stopped by hand.
- **What's learned.**
  - Each decided test is written on both videos.
  - The latest two winners, with the opening each beat, go to every script writer ahead of the openings that brought messages.
  - Review shows which kinds of opening have won.

New in `.env.example`: `INSTAGRAM_REPLIES`, `INSTAGRAM_WEBHOOK_TOKEN`.

## AT. Navigation: the daily stops, Setup's path and the menu

**The bar.**
- Today, Review, Create, Leads, Grow and Setup, each shown only to someone who can use it (`public/app.js` `PAGE_CAPS`).
- Admins also see Admin. A reviewer sees only Sign-off.
- Account, Guide and Billing (when there's a plan to manage) are in the menu under the initial. It closes on a tap elsewhere, on tabbing out of it, or on Escape (which puts focus back on the initial).
- **Landing.** The agent lands on Today, an assistant on Leads (Today if they can't see Leads), and a reviewer on Sign-off.
- On a phone, the bar, Setup's steps and Grow's tabs each scroll so the current one is in view.

**Where things moved** (older sections of this file use the old names):

| Before | Now |
|---|---|
| Review's greeting panels: the week ahead, Coming up, the coach's check-in, the recap, the streak nudge | Today |
| Review's What's working and rejections, and the opening tests | Grow → Results |
| Desk | Leads (`#/desk` opens it) |
| Communicate's keyword replies | Leads |
| Communicate, Mindset | Grow → Communicate, Grow → Mindset |
| Brand → End card, Your video pages (photo, landing, booking confirmations); Settings → Profile | Setup → Profile |
| Content (all tabs but Your voice); Brand → Your own clips | Setup → Library |
| Brand → Voice; Content → Your voice; Settings → Rules, What the app remembers | Setup → Voice and rules |
| Brand → Captions and footage; Settings → Video, Saved versions, What goes into a video | Setup → Look |
| Brand → Instagram, Facebook Page, Posting plan; Settings → Going away | Setup → Autopilot |
| People / Your team | Setup → Team |
| Account, Guide, Billing tabs | The menu under the initial |

**The older pages.** Content, Brand and Settings still open whole at their old addresses (`#/content`, `#/brand`, `#/settings`), and the bar marks them as Setup. Instagram's and Facebook's connect redirects come back to Setup → Autopilot (`#/autopilot?ig=…` or `?fb=…`); an older `#/brand?ig=…` link still works.

**The steps** (`public/screens/steps.js`).
- Each step is made of the same panels those pages always drew, now split into one function per panel in `brand.js`, `settings.js` and `content.js`. Editing, the save bar, Undo (Ctrl+Z), the "unsaved changes from earlier" offer and the coach work on a step as they do on the page it came from.
- **Who sees which steps:**
  - Profile, Library, Voice and rules, and Look need permission to change settings.
  - Autopilot needs settings or connecting accounts.
  - Team needs inviting people, or a done-for-you team to ask.
- So a done-for-you agent sees Autopilot and Team (Away mode is on Autopilot for them too). An assistant sees steps 1 to 5 if the agent lets them edit content; in a done-for-you workspace, where an assistant can ask the team for changes, they see Team. Otherwise an assistant sees no Setup.
- On Voice and rules, "Never use" is edited once, in the Rules panel (the Voice panel leaves it out there; on the older Brand page it still shows).

**Today** (`public/screens/today.js`). It reads `/api/today` and `/api/desk` (the day's list; if that can't load, Today says so with Try again rather than showing a clear day). The coach's weekly check-in writes itself here at the start of a new week. Today's counts refresh when new videos arrive. **Grow** (`public/screens/grow.js`) reads `/api/videos` and `/api/abtests`. No server routes changed for the navigation.
