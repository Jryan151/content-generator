# Agent Reels: the core

**Focus: producer to builder.** Build only what moves a producer to builder without their sales dropping. Everything else waits for real data. The same thing lives in code in `src/core.js`, and `test/core.test.js` fails if any of it points at code that doesn't exist.

## Core values

| Value | What it means | Enforced by |
| --- | --- | --- |
| **Production first** | A builder is a producer who never stopped producing. Recruiting work only shows when today's production is on track. | `productionRed`, the hold line in `placeOnLadder` |
| **Only business that sticks counts** | Placed and still-active policies are the score, not applications or recruits signed. | `quality()` |
| **One next action** | Every screen answers "what do I do now?" in black and white. | `placeOnLadder().nextAction`, `todoFor()` |
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

**Known gap:** weekly selling is still counted by applications, because there's no carrier placement data yet. `quality()` tracks placed and still-active alongside it; once placement flows in, the gates switch to placed policies.

## Required screens

All five are built in `public/` (`index.html`, `app.js`, `setup.js`) and run on the engine. **Mine** logs to the phone only until the shared database is connected; **Demo** runs a fictional leader's data (`seed/sample.js`, `seed/demo-pipeline.js`).

| Screen | Who | What it does | Reads |
| --- | --- | --- | --- |
| Setup | Leader, once | Three answers: agents selling now, start of day, what she wants to earn | `buildSystem` |
| Today | Every agent | One chain: who to call next → one tap for what happened → the next step set for you. Meetings due come first. Before licensing, a study day | `queueFor`, `logCall`, `logMeeting`, `todoFor`, `productionRed` |
| Pipeline | Every agent | Clients: contacted → appointment → submitted → placed. Recruits: name → interviewed → studying → licensed → first sale | lead stages, `RECRUIT_STAGES`, `isUnlocked` |
| Ladder | Every agent | Current stage, why, and the one gate to the next | `placeOnLadder` |
| Team | Leader | Each recruit's stage, production on track or not, how much of their business sticks, who needs help today | `placeOnLadder`, `redList`, `duplication`, `quality`, `whereItBroke` |

## How it holds up over months

- **Your log is versioned** (`src/store.js`): an app update upgrades your saved copy instead of losing it.
- **Backup and restore** live under the gear. Today reminds you when your last backup is a week old.
- **Speed:** three months of heavy use (about 10,000 entries) still loads in milliseconds; the test suite checks it.
- **Undo** for 10 seconds after every tap. Calls are logged as one outcome, so there are no counters to mistap.

## The one data record

Every screen reads the `activities` log: who, what action, which client or recruit, when, and the value. **Placed** is `policy_issued` (carrying its lead); a later lapse logs a `chargeback` on the same lead, so `quality()` knows the policy is no longer active.

## Parked until there's data

Code that exists stays where it is, so nothing needs a rebuild.

- Director and Upline paths and views
- Plan cascade and earnings-to-premium math (needs her contract level and real rates)
- Monthly, quarterly and yearly views
- Playbook screen (scripts attach to Today steps once the leader shares them)
- Commission tracker (`src/parked/`)
- Content and the post block
- Rules beyond production first
- Pricing and billing
- Real estate expansion
