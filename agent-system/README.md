# Agent System — foundation

One system that takes a producer to builder: recruiting and training a team without their own sales dropping.

**Start with [CORE.md](CORE.md):** the five core values, the ladder, the five required screens (Setup, Today, Pipeline, Ladder, Team), and everything parked until there's real data.

**Current focus: producer to builder.** The ladder runs Selling → Producer → Coach, and Coach is the finish line for now. Director and Upline are **parked**: their code and tests stay in place (`PARKED_PATHS`, `topStage: 'upline'`) so they can come back without a rebuild.
This repo is the **foundation**: the data model and the timeframe math every screen sits on.
No screens yet — those come next and plug straight into this.

> The blueprint doc is the source of truth for *what* to build. This repo is *how* it's stored and counted.

## No guessed numbers

Daily targets appear only when they can be real: her earnings goal, her contract level (set by you from her contract), and at least 10 days of her own activity with enough of each step to measure it. Until then she runs the **baseline**: the routine with no numbers, logging what she does. `buildSystem()` returns `targetsReady: false` and lists exactly what it's waiting on.

**Demo mode** (`public/index.html`, Demo switch) runs the same engine on a fictional leader's two months of logged activity (`seed/sample.js`, `DEMO`), and shows where every number comes from.

## The one rule

**Every action leaves one row in `activities`. Every number on every screen is a count or sum of those rows over a timeframe.**

That's why Pipeline, Today and Team can never disagree: they all read the same log.

## What's here

| Path | What it is |
| --- | --- |
| `db/schema.sql` | Postgres/Supabase schema: people + team tree, leads, the activity log, playbook, training, content bridge, the `rollup()` function, and row-level security |
| `src/metrics.js` | The single list of activity types and metrics (dials, appointments, premium, names-list conversations, recruiting steps…) and which timeframe headlines which. Recruiting is headlined by recruits licensed and reaching a first sale, never by recruits added |
| `src/setup.js` + `templates/` | **Setup, black and white**: 3 answers from the leader (agents selling now, start of day, what she wants to earn — converted to premium with her contract level), one agency kit filled by you, rates learned from logging, rules fixed. `buildSystem()` runs on whatever exists and says who it's waiting on |
| `src/career.js` | **Career stages**: places each person on Starting → Selling → Producer → Coach from real activity (Director and Upline parked; `FOCUS_TOP`), with one focus, what's unlocked, one gate and one next action |
| `src/core.js` | **The core**: the five values (each tied to the code that enforces it), the five required screens and what each reads, and the parked list. `test/core.test.js` fails if any of it points at missing code |
| `src/quality.js` | **Only business that sticks counts**: submitted → placed → still active at 3, 6 and 12 months, matched by lead. Rates stay blank until there's something real to divide |
| `src/parked/commissions.js` | **Parked.** Commission tracker: expected advances and overrides from issued policies and contract levels, matched to payments marked received; every item is paid, partial, late or due |
| `src/ladder.js` | **The climb** (Producer → Coach → Director → Upline): duplication metrics (agents producing, coaches, 90-day retention, days to first sale), the recruiting funnel, and level progress with one next action |
| `src/paths.js` | **The two leader paths** (Producer, Coach; Director parked): a 1-question picker, green/red status by fixed lines, and if-then rules that name the person and say exactly what to do |
| `src/routines.js` | **What to do** at each timeframe: the plan cascade (yearly goal → daily dials) and each role's routine, from the blocks of a day up to the year |
| `src/timeframes.js` | Micro-inside-macro math: buckets (1D/1W/1M/1Q/1Y), roll-ups, period-over-period, and `whereItBroke()` — the zoom-in loop |
| `seed/sample.js` | A sample team and two months of activity where one agent stalls in week 3 |
| `public/` | **The app**: Today, Pipeline, Ladder, Team and Setup on one page with tabs. Mine / Demo switch at the top |
| `src/calls.js` | **The call chain**: one outcome per call writes the right rows and sets the next date (applications on the call, call-backs and meetings with times, bad numbers); the kitchen-table check; policy care (welcome call, pre-draft call, missed-payment save with grace countdown); the queue; the day text for the upline |
| `src/store.js` | **Your log on one device**: versioned so updates never lose it, with backup, restore and a backup reminder |
| `src/pipeline.js` | **Pipeline moves**: moving a client or recruit writes the same activity rows as the database trigger |
| `seed/demo-pipeline.js` | Demo clients, recruits and team start dates for the fictional leader |
| `seed/demo.js` | `npm run demo` — prints the zoom-in loop finding that agent |
| `test/` | Tests for the timeframe math (`npm test`) |
| `db/test/` | Database checks against a real Postgres (`bash db/test/run.sh`) |

## Who sees what (enforced by the database, not the app)

| Person | Reads | Writes |
| --- | --- | --- |
| Agent | Own leads + activity, their leader's profile, approved playbook steps | Only their own rows |
| Builder | Own + everyone below them in the tree, draft playbook steps | Only their own rows + their playbook |
| Upline | Every builder and agent below them | Only their own rows |

The activity log is **append-only**: no one can edit or delete it, so the numbers can be trusted.

## Timeframes are for doing, not watching

The higher timeframe sets the plan; the lower timeframe is where you act.

- **Plan flows down** (`planDown`): a yearly premium goal → monthly apps → appointments → conversations → **daily dials**, using the agent's real conversion rates once there's history (`ratesFrom`), starter rates until then.
- **Each timeframe has a routine** (`ROUTINES`, `todoFor`): blocks of the day (dial block, one recruiting step, follow-ups, appointments, close-out; content optional), Monday planning, Friday review, first-workday-of-the-month targets, quarterly coaching decisions, the yearly goal. Agents and builders get different routines.
- **Results flow up** (`timeframes.js`): finished actions leave activity rows; the roll-ups check whether the plan held, and `whereItBroke` points at the level to fix.

```
Agent's list for Monday, Oct 26
  07:45  [1W   ] Plan the week: 6 appointments to book; refill leads if the list is short
  08:00  [block] Post today's content
  09:00  [block] Dial block: 38 dials from the call list
  13:00  [block] Clear follow-ups due and send appointment reminders
  14:00  [block] Run appointments with the Playbook open
  16:30  [block] Log everything; give every lead a next step for tomorrow
```

All times, routines and starter rates are defaults to replace with the builder's own.

## Setup, black and white

The system ships as the standard. A leader doesn't build it; she follows it. Every input is one of four kinds:

| Kind | What | Who |
| --- | --- | --- |
| **From her** (under a minute) | Agents selling now? · Start of day (early, standard, late) · What she wants to earn | The leader, once (`public/index.html`, which also has a Demo switch) |
| **From you** (once per agency) | Playbook, promotion rules, elite group requirements, advance terms; each person's contract level | You, in the agency kit (`templates/agency-kit.*.json`) |
| **Learned** | Conversion rates | Nobody: after 10 days of logging, her real rates replace the starters |
| **Fixed** | Red line, check times, routines, messages | The standard. Only the kit can reword a message |

- **Training builds itself** from the playbook, so nobody types it twice.
- **One start preset moves the whole day** for her and her agents.
- **`buildSystem()` never blocks.** It runs on starters and returns `waitingOn.her`, `waitingOn.you` and `waitingOn.learning`.
- **Agents never set anything up.** They tap what they did; moving a lead logs it automatically.

## Career stages: where you actually are

Many agencies push new agents to recruit from day one, so people recruit before they can teach anyone to sell, and the recruits quit. This ladder does the opposite on purpose: **you build only once you have something worth copying.** The stage is computed from activity, never chosen.

| Stage | Focus | Why | Gate to the next stage (starters) |
| --- | --- | --- | --- |
| Starting | Get your first sale | Nothing is real until you've closed once | First application |
| Selling | Sell every week | One sale can be luck; steady weeks prove a process | A sale in 4 of the last 6 weeks |
| Producer | Make your selling copyable | A recruit inherits your process | A sale in 6 of the last 8 weeks + your Playbook in your own words |
| Coach | Get your agents to a first sale, then steady sales | Your income shifts to your agents' sales, which only pays if they sell | Finish line for now (Director parked) |

Director (build coaches, not agents; 3 coaches you developed) and Upline (protect the standard) are parked. Pass `topStage: 'upline'` to `placeOnLadder` to switch them back on.

- **Leader gates are measured by the people under you**, placed on the same ladder. Head count never counts.
- **Locked until earned:** a names list opens at Producer; the recruiting pipeline and team view open at Coach.
- **Keep selling to keep your stage:** Producers and up need a sale in 3 of the last 6 weeks. Below that, focus steps back to Selling. It's a focus change, not a demotion.
- Every stage carries its reason (`why`) so the screen can always say why this is the focus.

## Commission tracker

Leaders often can't check their own pay. The system already knows every issued policy, so with contract levels (set by you, never typed by the agent) it shows:

- **Expected:** the advance on your own policies and the override (your spread over the person below you) on your team's, with the date each should land.
- **Received:** one tap marks a payment received.
- **Late:** due and not fully paid, in red, with the client, agent, amount and date: a clean record to take to the agency or carrier in writing.

Pay is private: only the person paid can see their payments, not their upline. The tracker covers **advances only**; the unadvanced balance and renewals depend on each carrier's schedule. It's a tracker and a record, not accounting or legal advice.

## Team reporting

Alongside the stages, `duplication()` reports how a builder's team is doing: agents *producing* (a sale in the last 30 days), *staying* (active in the last 14 days), 90-day retention, and median days to first sale. The **recruiting pipeline** (prospect → interviewed → licensing → licensed → first sale → producing) logs every stage change, so recruiting shows up in the same timeframes as selling. It opens at Coach.

## Two paths, black and white

Each leader stage runs one routine. On day one, one yes/no question seeds it (agents selling under you? no → Producer, yes → Coach); once there's activity, the career stage decides. Agents never pick: every agent gets the same day.

| Path | Motto | Their day | Moves on when |
| --- | --- | --- | --- |
| Producer | I sell, and I get ready to build. | Production first, then one names-list conversation a day | A sale in 6 of 8 weeks + Playbook written → Coach |
| Coach | I sell and I train. | Mornings produce plus one recruiting step, afternoons coach | Finish line for now |

**Production comes first.** Once the dial block is over, dials under 70% of the day's goal are red, and that day's recruiting step is hidden (`productionRed`, `todoFor({ now })`). **Content is optional:** the post block and the post reminder only appear when turned on.

Rules are fixed lines, not judgment calls: under 70% of pace is **red**, zero dials at noon gets **the noon message**, red two weeks running means **decide: coaching plan or let go**. `npm run demo` shows both paths reacting to the same moment. The parked Director path routes the same problems to the agent's coach.

## Timeframe keys

| Key | Example | Notes |
| --- | --- | --- |
| 1D | `2026-10-28` | The agent's **local** day (a 9 PM call in Phoenix counts that day) |
| 1W | `W:2026-10-26` | Starts Monday |
| 1M | `2026-10` | |
| 1Q | `2026-Q4` | |
| 1Y | `2026` | |

`whereItBroke()` does what a leader would do on the Team screen:

1. Is the metric down vs the last period? If not, stop.
2. Drop a level to the weakest week (compared **per day**, so a short week at a month edge isn't unfairly flagged).
3. In that week, find the agent whose daily input fell furthest below their own normal.

```
$ npm run demo
Where it broke
  1. Premium written 15510 vs 18110 the period before
  2. Weakest 1W inside 2026-10: Premium written 1690 over 7 day(s)
  3. Marcus J.: Dials 0/day vs usual 10.6/day
→ Fix the agent, not the month: check in with Marcus J.
```

## Automatic logging

Moving a lead in the Pipeline writes the activity for you, so agents never log twice:

| Lead moves to | Logged as |
| --- | --- |
| contacted | conversation |
| appointment | appt_set |
| application | app_written (with premium) |
| issued | policy_issued (with premium) |
| issued/lapse_risk → lost | chargeback |

Finishing a training task logs `training_task_done`.

## How it connects to what exists

- **Content generator:** stays its own app. `content_posts.generator_ref` points at a post in the generator; marking it posted logs a `post` activity. Nothing in the generator has to change to start.
- **Mockup:** the five screens in the Agent System Mockup map 1:1 onto these tables (Today = leads due + daily targets + today's post; Team = `rollup()` + `whereItBroke()`).

## Running it

```bash
npm test                 # timeframe math (no setup needed, Node 20+)
npm run demo             # the zoom-in loop on sample data
bash db/test/run.sh      # schema + security checks on a throwaway Postgres 14+,
                         # and proof that SQL and JS roll-ups give identical numbers
```

To use on Supabase: run `db/schema.sql` in the SQL editor of a new project. Don't run anything in `db/test/` there — those files fake Supabase's auth for local testing.

## Not built yet (on purpose)

- The shared database connection: the screens (`public/`) run on the engine now, but **Mine** saves to one phone until they talk to Supabase
- Click-to-call / texting — hold until a customer asks; connect to tools agents already use first
- Upline screen — the data and security already support it; the view comes later
- Billing
