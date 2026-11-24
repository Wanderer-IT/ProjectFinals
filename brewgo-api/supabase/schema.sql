-- Run this in Supabase: Dashboard > SQL Editor > New query > paste > Run.
-- Safe to run again at any time (everything is "if not exists" / "create or replace").
--
-- Supabase is the ONLY database of the Brew Go API. There is no copy of the data in the server's memory:
-- every request reads and writes these tables directly.

-- 1) One generic table: each row is one record (a user, an order, a cart...) stored as JSON.
create table if not exists public.brewgo_records (
  collection text        not null,            -- "users", "orders", "carts", ...
  id         bigint      not null,            -- the record's numeric id
  data       jsonb       not null,            -- the whole record
  updated_at timestamptz not null default now(),
  primary key (collection, id)
);

-- Indexes for the lookups the API does (by owner, e-mail, login token, order number, payment session...).
create index if not exists brewgo_records_user    on public.brewgo_records (collection, (data->>'userId'));
create index if not exists brewgo_records_email   on public.brewgo_records (collection, (data->>'email'));
create index if not exists brewgo_records_token   on public.brewgo_records (collection, (data->>'token'));
create index if not exists brewgo_records_order   on public.brewgo_records (collection, (data->>'orderNumber'));
create index if not exists brewgo_records_status  on public.brewgo_records (collection, (data->>'status'));

-- 2) Id counters (record ids, order numbers BG-8921..., cart item ids, ...). One row per counter.
create table if not exists public.brewgo_counters (
  name  text   primary key,
  value bigint not null            -- the NEXT number that will be handed out
);

-- 3) Lock both tables: the API uses the SERVICE ROLE key, which bypasses RLS.
-- With RLS on and no policies, the public "anon" key can read/write nothing,
-- so nobody can pull user data straight from your Supabase URL.
alter table public.brewgo_records  enable row level security;
alter table public.brewgo_counters enable row level security;

-- 4) Small atomic helpers. They make concurrent requests safe (two customers buying the last croissant,
--    two requests awarding points...) because Postgres does the read-modify-write in ONE statement.

-- Next id for a counter (starts at p_start the first time).
create or replace function public.brewgo_next_id(p_name text, p_start bigint default 1)
returns bigint language plpgsql set search_path = public as $$
declare v bigint;
begin
  insert into public.brewgo_counters (name, value) values (p_name, p_start + 1)
  on conflict (name) do update set value = public.brewgo_counters.value + 1
  returning value - 1 into v;
  return v;
end $$;

-- Add p_delta to a number field of one record (stock, pointsBalance...).
-- Returns the new value, or NULL when the record does not exist or the result would be below p_min.
create or replace function public.brewgo_adjust(p_collection text, p_id bigint, p_field text, p_delta numeric, p_min numeric default null)
returns numeric language plpgsql set search_path = public as $$
declare v numeric;
begin
  update public.brewgo_records
     set data = jsonb_set(data, array[p_field], to_jsonb(coalesce((data->>p_field)::numeric, 0) + p_delta)),
         updated_at = now()
   where collection = p_collection and id = p_id
     and (p_min is null or coalesce((data->>p_field)::numeric, 0) + p_delta >= p_min)
  returning (data->>p_field)::numeric into v;
  return v;
end $$;

-- Change only the given fields of one record (the others are left alone). Returns the whole record, or NULL.
create or replace function public.brewgo_merge(p_collection text, p_id bigint, p_changes jsonb)
returns jsonb language sql set search_path = public as $$
  update public.brewgo_records set data = data || p_changes, updated_at = now()
   where collection = p_collection and id = p_id
  returning data;
$$;

-- Only the server (service_role) may call them, never the public anon key.
revoke all on function public.brewgo_next_id(text, bigint)                      from public, anon, authenticated;
revoke all on function public.brewgo_adjust(text, bigint, text, numeric, numeric) from public, anon, authenticated;
revoke all on function public.brewgo_merge(text, bigint, jsonb)                  from public, anon, authenticated;
grant execute on function public.brewgo_next_id(text, bigint)                      to service_role;
grant execute on function public.brewgo_adjust(text, bigint, text, numeric, numeric) to service_role;
grant execute on function public.brewgo_merge(text, bigint, jsonb)                  to service_role;

-- 5) UPGRADING from the older version of this project (which kept its counters in a "_meta" row)?
--    These two statements carry the counters over so ids and order numbers continue without repeats.
--    On a brand-new project they do nothing.
insert into public.brewgo_counters (name, value)
select c.key, c.value::bigint
  from public.brewgo_records r, jsonb_each_text(r.data->'counters') c
 where r.collection = '_meta'
on conflict (name) do update set value = greatest(public.brewgo_counters.value, excluded.value);

insert into public.brewgo_counters (name, value)
select collection, max(id) + 1 from public.brewgo_records where collection <> '_meta' group by collection
on conflict (name) do update set value = greatest(public.brewgo_counters.value, excluded.value);
