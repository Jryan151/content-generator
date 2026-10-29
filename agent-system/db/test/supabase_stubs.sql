-- Test-only stand-ins for what Supabase already provides.
-- Never run this on Supabase itself.
create extension if not exists pgcrypto;
create schema if not exists auth;
create table if not exists auth.users (id uuid primary key);

-- Supabase's auth.uid() reads the signed-in user from the request.
-- Here the tests set it with:  set app.uid = '<uuid>';
create or replace function auth.uid() returns uuid
language sql stable as $$ select nullif(current_setting('app.uid', true), '')::uuid $$;

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
end $$;
grant usage on schema auth to authenticated;
