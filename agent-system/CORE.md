# Agent Reels: the core

**Focus: producer to builder.** Build only what moves a producer to builder without their sales dropping. Everything else waits for real data. The same thing lives in code in `src/core.js`, and `test/core.test.js` fails if any of it points at code that doesn't exist.

**Starting product: final expense.** Built for final expense agents first: a short sales cycle, frequent applications, and payment drafts as the main risk. Other products (IUL, term) wait until this works.

## Core values

| Value | What it means | Enforced by |
| --- | --- | --- |
| **Production first** | A builder is a producer who never stopped producing. When her own calls are down (days off don't count), that comes first and team work waits. One check does it. | `ownProduction`, the hold line in `placeOnLadder` |
| **Only business that sticks counts** | Placed and still-active policies are the score, not applications or recruits signed. "Selling every week" counts placed policies once there are any. | `quality()`, `weeksWithASale`, `payPicture` |
| **One next action** | Every screen answers "what do I do now?" in black and white. Today shows five things at most. | `todayLayout`, `dayStatus`, `placeOnLadder().nextAction` |
| **Log once, compute everything** | One tap per action. Every number comes from the activity log. | `addActivity`, `totalsFor`, the stage-change trigger |
| **Real or blank** | No fake or placeholder numbers. Missing data shows as "needs data." | `buildSystem().waitingOn`, `quality().needsData` |

## The ladder

The stage is computed from activity, never chosen.

| Stage | Focus | Gets you to the next stage |
| --- | --- | --- |
| Licensing (only if you start unlicensed) | Pass your licensing exam | Exam passed |
| Starting | Get your first sale | First application |
| Selling | Sell every week | Sales in most recent weeks |
| Producer | Make your selling copyable; start a names list | Steady weekly sales + Playbook in your own words |
| **Coach** (finish line for now) | Get your recruits to a first sale, then steady sales | You're a **builder** once a recruit you brought in reaches Selling |

Gate counts (weeks with a sale) are starter rules, replaced by the agency's real promotion rules when we have them.

**Weekly selling counts placed policies** once someone has any in their log: a week counts when an application written that week was placed. Before any placement data exists it counts applications and says so (`weeksWithASale().source`).

## Simple (held by `test/simple.test.js`)

Built for busy people who don't read instructions. Drift fails a test instead of piling up quietly.

- **Today shows five things at most** above "More", always in this order, like an effects chain: what can't wait → the next call → one team thing → her day so far → done for today (last). A next call and "done" never show together. Everything else (a quick call, adding people, texting her day, a day off, her schedule) is behind "More". (`src/today.js`)
- **Plain words.** Nothing a person reads says pipeline, override, parked, production first, red list, recruiting step, names list or ladder.
- **One feature per job.** `SIMPLE.jobs` in `src/core.js` lists each job once, with the one feature that does it. A fix replaces; it doesn't add a second tool for the same job.

## Required screens

All five are built in `public/` (`index.html`, `app.js`, `setup.js`) and run on the engine. **Mine** logs to the phone only until the shared database is connected; **Demo** runs a fictional leader's data (`seed/sample.js`, `seed/demo-pipeline.js`).

| Screen | Who | What it does | Reads |
| --- | --- | --- | --- |
| Setup | Leader, once | Three answers: agents selling now, start of day, what she wants to earn | `buildSystem` |
| Today | Every agent | Five slots at most, in chain order: missed-payment saves and meetings today → the next call (welcome and pre-draft calls first) → one team thing (or "your calls are low", which comes first) → her day so far → done for today, with what her sales and her team paid her. The rest is behind "More". Days off never count as "down". When targets set her full day, a note says why it moved and asks when her day ends. Before licensing, a study day | `todayLayout`, `dayStatus`, `queueFor`, `logCall`, `ownProduction`, `leaderView` |
| My people | Leader (and a producer with recruits) | Who could use her, one plain sentence and one button each; then her recruits one at a time, the one needing the next step first | `leaderView`, `applyCheckins`, `moveRecruit`, `daysInStage` |
| Progress | Every agent | A leader: what her team paid her next to her own sales, three readings (people selling every week, people she grew, team sales vs hers), still paying, this month's one step, and a monthly "producer or builder?" question. An agent: their focus and the one thing to the next stage | `placeOnLadder`, `builderMeasure`, `payPicture`, `quality` |
| Clients | Every agent | Everyone she's working with, by where they stand; the insurer's answer and missed payments are marked here | lead stages, `approvePolicy`, `markPaymentMissed` |

## How it holds up over months

- **Your log is versioned** (`src/store.js`): an app update upgrades your saved copy instead of losing it.
- **Backup and restore** live under the gear. Today reminds you when your last backup is a week old.
- **Speed:** three months of heavy use (about 10,000 entries) still loads in milliseconds; the test suite checks it.
- **Undo** for 10 seconds after every tap. Calls are logged as one outcome, so there are no counters to mistap.

## The one data record

Every screen reads the `activities` log: who, what action, which client or recruit, when, and the value. **Placed** is `policy_issued` (carrying its lead); a later lapse logs a `chargeback` on the same lead, so `quality()` knows the policy is no longer active.

## Parked until there's data

Code that exists stays where it is, so nothing needs a rebuild.

- Director and Upline stages and views
- Plan cascade and earnings-to-premium math (needs her contract level and real rates)
- Monthly, quarterly and yearly views
- Playbook screen (scripts attach to Today steps once the leader shares them)
- Commission tracker: payments received, late and partial (`src/parked/`). Her pay picture is live: `src/pay.js`
- Content and the post block
- Rules beyond production first
- Pricing and billing
- Real estate expansion
