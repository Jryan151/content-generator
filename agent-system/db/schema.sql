-- Agent System — database foundation (Postgres / Supabase)
--
-- One rule holds the whole design together:
--   every action leaves ONE row in `activities`, and every number on every
--   screen is a count or sum of those rows over a timeframe.
--
-- Visibility follows the team tree: an agent sees their own rows; a builder
-- sees their own plus everyone below them; an upline sees every builder below.
-- Runs on Supabase as-is (uses auth.uid()). Order matters: run top to bottom.

-- ───────────────────────── Types ─────────────────────────

create type user_role as enum ('agent', 'builder', 'upline');

-- A leader's path decides their routine and which rules fire (src/paths.js).
create type leader_path as enum ('producer', 'coach', 'director');

-- One preset moves a person's whole day (src/setup.js START_PRESETS).
create type day_start as enum ('early', 'standard', 'late');

create type lead_stage as enum (
  'new',          -- just came in
  'contacted',    -- reached at least once
  'appointment',  -- appointment booked
  'application',  -- application written, waiting on carrier
  'issued',       -- policy in force
  'lapse_risk',   -- issued, but a payment was missed
  'lost'          -- closed without a sale, or lapsed
);

create type activity_type as enum (
  'dial', 'conversation', 'followup_done', 'post',
  'appt_set', 'appt_held', 'app_written', 'policy_issued',
  'chargeback', 'recruit_added', 'training_task_done',
  'recruit_interviewed', 'recruit_licensed',
  'names_conversation', 'recruit_step', 'recruit_first_sale',
  'study_session', 'practice_test', 'license_passed'
);

-- The builder's pipeline: people on their way to becoming producing agents.
create type recruit_stage as enum (
  'prospect', 'interviewed', 'licensing', 'licensed', 'first_sale', 'producing', 'dropped'
);

-- ───────────────────────── People + the team tree ─────────────────────────

create table profiles (
  id            uuid primary key references auth.users (id) on delete cascade,
  full_name     text not null,
  role          user_role not null default 'agent',
  upline_id     uuid references profiles (id) on delete set null, -- who this person reports to
  coach_id      uuid references profiles (id) on delete set null, -- who handles their red flags (Director path)
  path          leader_path,                                      -- leaders only; agents all share one routine
  started_on    date not null default current_date,               -- first 30 days = training rules apply
  is_coach      boolean not null default false,                    -- coaches newer agents for their leader
  day_start     day_start not null default 'standard',            -- her one choice about time
  yearly_goal   numeric(12,2),                                     -- her one number; everything else is learned or set by you
  contract_percent numeric(5,2),                                   -- contract level, set by you; drives the commission tracker
  timezone      text not null default 'America/Phoenix',          -- buckets use the agent's local day
  created_at    timestamptz not null default now(),
  constraint no_self_upline check (upline_id is null or upline_id <> id),
  constraint path_for_leaders check (path is null or role <> 'agent')
);
create index profiles_upline_idx on profiles (upline_id);

-- Everyone at or below `root` in the tree (root included).
create or replace function downline(root uuid)
returns table (id uuid)
language sql stable security definer set search_path = public as $$
  with recursive tree as (
    select p.id from profiles p where p.id = root
    union
    select p.id from profiles p join tree t on p.upline_id = t.id
  )
  select id from tree;
$$;

-- Can the signed-in user see rows that belong to `owner`?
create or replace function can_see(owner uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from downline(auth.uid()) d where d.id = owner);
$$;

-- ───────────────────────── Pipeline ─────────────────────────

create table leads (
  id                 uuid primary key default gen_random_uuid(),
  agent_id           uuid not null references profiles (id) on delete cascade,
  full_name          text not null,
  phone              text,
  email              text,
  source             text,                 -- 'facebook_ad', 'referral', 'mailer', ...
  stage              lead_stage not null default 'new',
  next_followup_at   timestamptz,          -- drives the Today call list
  annual_premium     numeric(10,2),        -- once quoted / written
  consent_to_contact boolean not null default false, -- needed before calls/texts
  consent_at         timestamptz,
  notes              text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index leads_agent_stage_idx on leads (agent_id, stage);
create index leads_followup_idx on leads (agent_id, next_followup_at);

-- ───────────────────────── The activity log (append-only) ─────────────────────────

create table activities (
  id          bigint generated always as identity primary key,
  agent_id    uuid not null references profiles (id) on delete cascade,
  lead_id     uuid references leads (id) on delete set null,
  type        activity_type not null,
  value       numeric(10,2),               -- premium for app_written / policy_issued / chargeback
  occurred_at timestamptz not null default now(),
  meta        jsonb not null default '{}'
);
create index activities_agent_time_idx on activities (agent_id, occurred_at);
create index activities_type_time_idx on activities (type, occurred_at);

-- Moving a lead to a new stage logs the matching activity automatically,
-- so the Pipeline board and the Team numbers can never disagree.
create or replace function log_stage_change()
returns trigger language plpgsql as $$
declare
  t activity_type;
begin
  if new.stage is not distinct from old.stage then
    new.updated_at := now();
    return new;
  end if;
  t := case new.stage
         when 'contacted'   then 'conversation'
         when 'appointment' then 'appt_set'
         when 'application' then 'app_written'
         when 'issued'      then 'policy_issued'
         else null
       end;
  if t is not null then
    insert into activities (agent_id, lead_id, type, value, meta)
    values (new.agent_id, new.id, t,
            case when t in ('app_written', 'policy_issued') then new.annual_premium end,
            jsonb_build_object('from_stage', old.stage, 'to_stage', new.stage));
  end if;
  -- A lapse after issue is a chargeback.
  if new.stage = 'lost' and old.stage in ('issued', 'lapse_risk') then
    insert into activities (agent_id, lead_id, type, value, meta)
    values (new.agent_id, new.id, 'chargeback', new.annual_premium,
            jsonb_build_object('from_stage', old.stage));
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create trigger leads_stage_change
before update of stage on leads
for each row execute function log_stage_change();

-- ───────────────────────── Recruiting pipeline (the climb) ─────────────────────────

create table recruits (
  id          uuid primary key default gen_random_uuid(),
  builder_id  uuid not null references profiles (id) on delete cascade, -- whose team they'd join
  full_name   text not null,
  phone       text,
  email       text,
  source      text,                  -- 'referral', 'social', 'client', ...
  stage       recruit_stage not null default 'prospect',
  next_step_at timestamptz,
  profile_id  uuid references profiles (id) on delete set null, -- set once they become an agent
  notes       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index recruits_builder_stage_idx on recruits (builder_id, stage);

-- Moving a recruit forward is activity for the builder, so recruiting shows up
-- in the same timeframes as selling.
create or replace function log_recruit_stage()
returns trigger language plpgsql as $$
declare
  t activity_type;
begin
  if tg_op = 'UPDATE' and new.stage is not distinct from old.stage then
    new.updated_at := now();
    return new;
  end if;
  t := case new.stage
         when 'prospect'    then 'recruit_added'
         when 'interviewed' then 'recruit_interviewed'
         when 'licensing'   then 'recruit_step'
         when 'licensed'    then 'recruit_licensed'
         when 'first_sale'  then 'recruit_first_sale'
         else null
       end;
  if t is not null then
    insert into activities (agent_id, type, meta)
    values (new.builder_id, t, jsonb_build_object('recruit_id', new.id, 'stage', new.stage));
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create trigger recruits_stage_logged
before insert or update of stage on recruits
for each row execute function log_recruit_stage();

-- ───────────────────────── Commission tracker ─────────────────────────
-- Expected payments are computed from issued policies and contract levels
-- (src/commissions.js). Only what ARRIVED is stored: one row per payment,
-- tied to the expected item it pays. Private to the person paid.

create table payments (
  id           uuid primary key default gen_random_uuid(),
  person_id    uuid not null references profiles (id) on delete cascade,
  expected_id  text not null,          -- '<policy id>:advance|override:<person id>'
  amount       numeric(10,2) not null check (amount > 0),
  received_on  date not null default current_date,
  note         text,
  created_at   timestamptz not null default now()
);
create index payments_person_idx on payments (person_id, expected_id);

-- ───────────────────────── Playbook ─────────────────────────

create table playbooks (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null references profiles (id) on delete cascade, -- the builder
  title      text not null,
  created_at timestamptz not null default now()
);

create table playbook_steps (
  id          uuid primary key default gen_random_uuid(),
  playbook_id uuid not null references playbooks (id) on delete cascade,
  position    int not null,
  title       text not null,
  goal        text,
  say_lines   text[] not null default '{}',
  approved    boolean not null default false, -- compliance sign-off before agents see it
  unique (playbook_id, position)
);

create table objections (
  id       uuid primary key default gen_random_uuid(),
  step_id  uuid not null references playbook_steps (id) on delete cascade,
  question text not null,
  answer   text not null
);

-- ───────────────────────── Training (built from the Playbook) ─────────────────────────

create table training_tasks (
  id          uuid primary key default gen_random_uuid(),
  playbook_id uuid not null references playbooks (id) on delete cascade,
  week        int not null check (week between 1 and 4),
  position    int not null,
  text        text not null,
  step_id     uuid references playbook_steps (id) on delete set null, -- the lesson it teaches
  unique (playbook_id, week, position)
);

create table training_progress (
  agent_id uuid not null references profiles (id) on delete cascade,
  task_id  uuid not null references training_tasks (id) on delete cascade,
  done_at  timestamptz not null default now(),
  primary key (agent_id, task_id)
);

-- Finishing a training task is an activity too.
create or replace function log_training_done()
returns trigger language plpgsql as $$
begin
  insert into activities (agent_id, type, occurred_at, meta)
  values (new.agent_id, 'training_task_done', new.done_at, jsonb_build_object('task_id', new.task_id));
  return new;
end;
$$;

create trigger training_progress_logged
after insert on training_progress
for each row execute function log_training_done();

-- ───────────────────────── Content (bridge to the existing generator) ─────────────────────────

create table content_posts (
  id            uuid primary key default gen_random_uuid(),
  agent_id      uuid not null references profiles (id) on delete cascade,
  generator_ref text,            -- id of the video/post in the generator app
  body          text,
  scheduled_for date,
  posted_at     timestamptz
);

-- ───────────────────────── Timeframe roll-up ─────────────────────────
-- One function behind every number on the Team screen.
-- p_tf: '1D' | '1W' | '1M' | '1Q' | '1Y'. Buckets use each agent's own time zone,
-- so a 9 PM call in Phoenix counts on that day. Weeks start Monday (matches the app).

create or replace function rollup(p_tf text, p_from timestamptz, p_to timestamptz)
returns table (
  bucket          date,
  agent_id        uuid,
  dials           bigint,
  conversations   bigint,
  followups       bigint,
  posts           bigint,
  appts_set       bigint,
  appts_held      bigint,
  apps_written    bigint,
  premium_written numeric,
  policies_placed bigint,
  premium_issued  numeric,
  chargebacks     bigint,
  recruits        bigint,
  training_done   bigint,
  names_conversations bigint,
  recruit_steps   bigint,
  recruits_licensed bigint,
  recruit_first_sales bigint
)
language sql stable security invoker set search_path = public as $$
  select
    date_trunc(
      case p_tf when '1D' then 'day' when '1W' then 'week' when '1M' then 'month'
                when '1Q' then 'quarter' when '1Y' then 'year' end,
      a.occurred_at at time zone p.timezone
    )::date as bucket,
    a.agent_id,
    count(*) filter (where a.type = 'dial'),
    count(*) filter (where a.type = 'conversation'),
    count(*) filter (where a.type = 'followup_done'),
    count(*) filter (where a.type = 'post'),
    count(*) filter (where a.type = 'appt_set'),
    count(*) filter (where a.type = 'appt_held'),
    count(*) filter (where a.type = 'app_written'),
    coalesce(sum(a.value) filter (where a.type = 'app_written'), 0),
    count(*) filter (where a.type = 'policy_issued'),
    coalesce(sum(a.value) filter (where a.type = 'policy_issued'), 0),
    count(*) filter (where a.type = 'chargeback'),
    count(*) filter (where a.type = 'recruit_added'),
    count(*) filter (where a.type = 'training_task_done'),
    count(*) filter (where a.type = 'names_conversation'),
    count(*) filter (where a.type in ('recruit_added', 'recruit_interviewed', 'recruit_licensed', 'recruit_step', 'recruit_first_sale')),
    count(*) filter (where a.type = 'recruit_licensed'),
    count(*) filter (where a.type = 'recruit_first_sale')
  from activities a
  join profiles p on p.id = a.agent_id
  where a.occurred_at >= p_from and a.occurred_at < p_to
    and p_tf in ('1D', '1W', '1M', '1Q', '1Y')
  group by 1, 2
  order by 1, 2;
$$;

-- ───────────────────────── Row-level security ─────────────────────────
-- Read: yourself + your downline. Write: only your own rows.
-- `security invoker` on rollup() means it inherits these rules automatically.

alter table profiles          enable row level security;
alter table leads             enable row level security;
alter table activities        enable row level security;
alter table playbooks         enable row level security;
alter table playbook_steps    enable row level security;
alter table objections        enable row level security;
alter table training_tasks    enable row level security;
alter table training_progress enable row level security;
alter table content_posts     enable row level security;
alter table recruits          enable row level security;
alter table payments          enable row level security;

-- Your own upline (so an agent can see who their leader is). Security definer
-- avoids a policy that reads its own table, which Postgres rejects as recursion.
create or replace function my_upline_id()
returns uuid language sql stable security definer set search_path = public as $$
  select upline_id from profiles where id = auth.uid();
$$;

create policy profiles_read  on profiles for select using (can_see(id) or id = my_upline_id());
create policy profiles_self  on profiles for update using (id = auth.uid()) with check (id = auth.uid());

create policy leads_read     on leads for select using (can_see(agent_id));
create policy leads_insert   on leads for insert with check (agent_id = auth.uid());
create policy leads_update   on leads for update using (agent_id = auth.uid()) with check (agent_id = auth.uid());

create policy activities_read   on activities for select using (can_see(agent_id));
create policy activities_insert on activities for insert with check (agent_id = auth.uid());
-- No update/delete policy: the log is append-only.

-- A playbook is readable by its owner and everyone in the owner's downline,
-- or by anyone whose upline owns it.
create or replace function can_read_playbook(pb uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from playbooks b
    where b.id = pb
      and exists (select 1 from downline(b.owner_id) d where d.id = auth.uid())
  );
$$;

create policy playbooks_read  on playbooks for select using (can_read_playbook(id));
create policy playbooks_write on playbooks for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

-- Agents only see approved steps; the owner sees drafts too.
create policy steps_read on playbook_steps for select using (
  can_read_playbook(playbook_id)
  and (approved or exists (select 1 from playbooks b where b.id = playbook_id and b.owner_id = auth.uid()))
);
create policy steps_write on playbook_steps for all
  using (exists (select 1 from playbooks b where b.id = playbook_id and b.owner_id = auth.uid()))
  with check (exists (select 1 from playbooks b where b.id = playbook_id and b.owner_id = auth.uid()));

create policy objections_read on objections for select using (
  exists (select 1 from playbook_steps s where s.id = step_id)  -- inherits steps_read
);
create policy objections_write on objections for all
  using (exists (select 1 from playbook_steps s join playbooks b on b.id = s.playbook_id where s.id = step_id and b.owner_id = auth.uid()))
  with check (exists (select 1 from playbook_steps s join playbooks b on b.id = s.playbook_id where s.id = step_id and b.owner_id = auth.uid()));

create policy tasks_read  on training_tasks for select using (can_read_playbook(playbook_id));
create policy tasks_write on training_tasks for all
  using (exists (select 1 from playbooks b where b.id = playbook_id and b.owner_id = auth.uid()))
  with check (exists (select 1 from playbooks b where b.id = playbook_id and b.owner_id = auth.uid()));

create policy progress_read   on training_progress for select using (can_see(agent_id));
create policy progress_insert on training_progress for insert with check (agent_id = auth.uid());

create policy posts_read  on content_posts for select using (can_see(agent_id));
create policy posts_write on content_posts for all using (agent_id = auth.uid()) with check (agent_id = auth.uid());

-- A builder works their own recruits; their upline can see them (can_see).
create policy recruits_read  on recruits for select using (can_see(builder_id));
create policy recruits_write on recruits for all using (builder_id = auth.uid()) with check (builder_id = auth.uid());

-- Pay is private: only the person paid can see or record it — not their upline.
create policy payments_own on payments for all using (person_id = auth.uid()) with check (person_id = auth.uid());
