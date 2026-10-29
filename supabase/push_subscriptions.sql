-- Tabela de inscrições push (Web Push) por usuário.
-- Execute no SQL Editor do Supabase (junto com o supabase.sql original).

create table if not exists public.push_subscriptions (
  id         uuid primary key default gen_random_uuid(),
  user_id   uuid not null references auth.users(id) on delete cascade,
  endpoint  text not null unique,
  keys      jsonb not null,
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);

alter table public.push_subscriptions enable row level security;

drop policy if exists "push_subscriptions_own" on public.push_subscriptions;
create policy "push_subscriptions_own"
  on public.push_subscriptions
  for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
