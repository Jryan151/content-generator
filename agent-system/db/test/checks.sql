-- Database checks. Each block raises an error (and stops the run) if a rule breaks.
\set ON_ERROR_STOP on

-- People: Morgan leads Devon and Marcus; Outsider is on nobody's team.
insert into auth.users (id) values
  ('00000000-0000-4000-8000-000000000001'),
  ('00000000-0000-4000-8000-000000000002'),
  ('00000000-0000-4000-8000-000000000004'),
  ('00000000-0000-4000-8000-000000000009');
insert into profiles (id, full_name, role, upline_id) values
  ('00000000-0000-4000-8000-000000000001', 'Morgan', 'builder', null),
  ('00000000-0000-4000-8000-000000000002', 'Devon',   'agent', '00000000-0000-4000-8000-000000000001'),
  ('00000000-0000-4000-8000-000000000004', 'Marcus',  'agent', '00000000-0000-4000-8000-000000000001'),
  ('00000000-0000-4000-8000-000000000009', 'Outsider','agent', null);

insert into leads (id, agent_id, full_name, stage, annual_premium) values
  ('10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002', 'Dorothy R.', 'new', 600),
  ('10000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000004', 'James P.',   'new', 540),
  ('10000000-0000-4000-8000-000000000009', '00000000-0000-4000-8000-000000000009', 'Not yours',  'new', 999);

grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant execute on all functions in schema public to authenticated;

-- ── Marcus (agent): sees only his own leads ──
set role authenticated;
set app.uid = '00000000-0000-4000-8000-000000000004';
do $$ begin
  if (select count(*) from leads) <> 1 then raise exception 'agent should see exactly 1 lead, saw %', (select count(*) from leads); end if;
  if (select full_name from leads) <> 'James P.' then raise exception 'agent saw the wrong lead'; end if;
  -- He can see his leader's profile, but not a teammate's.
  if not exists (select 1 from profiles where full_name = 'Morgan') then raise exception 'agent should see his upline'; end if;
  if exists (select 1 from profiles where full_name = 'Devon') then raise exception 'agent should not see a teammate'; end if;
end $$;

-- Marcus books an appointment → the trigger logs appt_set by itself.
update leads set stage = 'appointment' where id = '10000000-0000-4000-8000-000000000002';
update leads set stage = 'application' where id = '10000000-0000-4000-8000-000000000002';
do $$ begin
  if (select count(*) from activities where type = 'appt_set') <> 1 then raise exception 'stage change did not log appt_set'; end if;
  if (select value from activities where type = 'app_written') <> 540 then raise exception 'app_written should carry the premium'; end if;
end $$;

-- The carrier issues it → placed, logged with the lead so a later lapse can be matched.
update leads set stage = 'issued' where id = '10000000-0000-4000-8000-000000000002';
do $$ begin
  if (select lead_id from activities where type = 'policy_issued') <> '10000000-0000-4000-8000-000000000002' then
    raise exception 'policy_issued should carry its lead so quality can follow it';
  end if;
  if (select sum(policies_placed) from rollup('1M', '2026-01-01', '2027-12-31')) <> 1 then
    raise exception 'rollup should count one placed policy';
  end if;
end $$;

-- It lapses → a chargeback on the same lead, so it stops counting as active.
update leads set stage = 'lost' where id = '10000000-0000-4000-8000-000000000002';
do $$ begin
  if (select lead_id from activities where type = 'chargeback') <> '10000000-0000-4000-8000-000000000002' then
    raise exception 'a lapse after issue should log a chargeback on the same lead';
  end if;
end $$;

-- He cannot touch someone else's lead (update silently matches 0 rows under RLS).
update leads set stage = 'lost' where id = '10000000-0000-4000-8000-000000000001';

-- He cannot write activity as someone else.
do $$ begin
  begin
    insert into activities (agent_id, type) values ('00000000-0000-4000-8000-000000000002', 'dial');
    raise exception 'agent wrote activity for another agent';
  exception when insufficient_privilege then null;
  end;
end $$;

-- The log is append-only: deletes do nothing.
delete from activities;
do $$ begin
  if (select count(*) from activities) = 0 then raise exception 'activity log should be append-only'; end if;
end $$;

-- Devon logs some dials.
set app.uid = '00000000-0000-4000-8000-000000000002';
insert into activities (agent_id, type, occurred_at) values
  ('00000000-0000-4000-8000-000000000002', 'dial', '2026-10-28 16:00+00'),
  ('00000000-0000-4000-8000-000000000002', 'dial', '2026-10-31 04:00+00'); -- 9 PM Oct 30 in Phoenix
do $$ begin
  if (select stage from leads where id = '10000000-0000-4000-8000-000000000001') <> 'new' then
    raise exception 'another agent changed Devon''s lead';
  end if;
end $$;

-- Outsider writes premium Morgan must never see.
set app.uid = '00000000-0000-4000-8000-000000000009';
insert into activities (agent_id, type, value, occurred_at) values
  ('00000000-0000-4000-8000-000000000009', 'app_written', 9999, '2026-10-14 19:00+00');

-- ── Morgan (builder): sees her whole team, nobody else ──
set app.uid = '00000000-0000-4000-8000-000000000001';
do $$ begin
  if (select count(*) from leads) <> 2 then raise exception 'builder should see her 2 team leads, saw %', (select count(*) from leads); end if;
  if exists (select 1 from rollup('1M', '2026-01-01', '2027-01-01') where premium_written = 9999) then
    raise exception 'builder saw an outsider''s premium';
  end if;
  -- Time zone: the 9 PM Phoenix dial lands on Oct 30, not Oct 31.
  if not exists (
    select 1 from rollup('1D', '2026-10-01', '2026-11-02')
    where bucket = '2026-10-30' and agent_id = '00000000-0000-4000-8000-000000000002' and dials = 1
  ) then raise exception 'late-evening dial was bucketed on the wrong day'; end if;
  -- Weeks start Monday.
  if not exists (select 1 from rollup('1W', '2026-10-01', '2026-11-02') where bucket = '2026-10-26') then
    raise exception 'weekly bucket should start on Monday 2026-10-26';
  end if;
end $$;

-- ── Playbook: agents only see approved steps ──
insert into playbooks (id, owner_id, title) values ('20000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', 'Final expense');
insert into playbook_steps (playbook_id, position, title, approved) values
  ('20000000-0000-4000-8000-000000000001', 1, 'Opening the call', true),
  ('20000000-0000-4000-8000-000000000001', 2, 'Draft step', false);
set app.uid = '00000000-0000-4000-8000-000000000004';
do $$ begin
  if (select count(*) from playbook_steps) <> 1 then raise exception 'agent should only see approved steps'; end if;
end $$;
set app.uid = '00000000-0000-4000-8000-000000000009';
do $$ begin
  if (select count(*) from playbooks) <> 0 then raise exception 'outsider should not see Morgan''s playbook'; end if;
end $$;

-- ── Recruiting: the builder's pipeline logs activity; agents can't see it ──
set app.uid = '00000000-0000-4000-8000-000000000001';
insert into recruits (id, builder_id, full_name) values ('30000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', 'Pat Prospect');
update recruits set stage = 'interviewed' where id = '30000000-0000-4000-8000-000000000001';
update recruits set stage = 'licensing' where id = '30000000-0000-4000-8000-000000000001';
update recruits set stage = 'licensed' where id = '30000000-0000-4000-8000-000000000001';
update recruits set stage = 'first_sale' where id = '30000000-0000-4000-8000-000000000001';
do $$ begin
  if (select count(*) from activities where agent_id = '00000000-0000-4000-8000-000000000001'
        and type in ('recruit_added', 'recruit_interviewed', 'recruit_step', 'recruit_licensed', 'recruit_first_sale')) <> 5 then
    raise exception 'recruit stage changes should log 5 activities';
  end if;
end $$;
set app.uid = '00000000-0000-4000-8000-000000000004';
do $$ begin
  if (select count(*) from recruits) <> 0 then raise exception 'an agent should not see the leader''s recruits'; end if;
end $$;

-- ── Pay is private: the leader can't see an agent's payments, and vice versa ──
set app.uid = '00000000-0000-4000-8000-000000000002';
insert into payments (person_id, expected_id, amount) values ('00000000-0000-4000-8000-000000000002', 'L1:advance:dev', 450);
set app.uid = '00000000-0000-4000-8000-000000000001';
do $$ begin
  if (select count(*) from payments) <> 0 then raise exception 'a leader should not see an agent''s pay'; end if;
  begin
    insert into payments (person_id, expected_id, amount) values ('00000000-0000-4000-8000-000000000002', 'x', 1);
    raise exception 'a leader recorded pay for someone else';
  exception when insufficient_privilege then null;
  end;
end $$;

reset role;
\echo 'ALL DATABASE CHECKS PASSED'
