-- Run this ONCE in Supabase: Dashboard > SQL Editor > New query > paste > Run.
-- One generic table: each row is one record (a user, an order, a cart...) stored as JSON.
create table if not exists public.brewgo_records (
  collection text        not null,            -- "users", "orders", "carts", ...
  id         bigint      not null,            -- the record's numeric id
  data       jsonb       not null,            -- the whole record
  updated_at timestamptz not null default now(),
  primary key (collection, id)
);

-- Lock the table: the API uses the SERVICE ROLE key, which bypasses RLS.
-- With RLS on and no policies, the public "anon" key can read/write nothing,
-- so nobody can pull user data straight from your Supabase URL.
alter table public.brewgo_records enable row level security;
