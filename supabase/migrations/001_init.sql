-- HoluVantage Daily Logic — initial schema.
-- All access goes through the server (service role). RLS is enabled with no policies,
-- and table/function privileges are revoked from anon/authenticated as defence in depth.

create extension if not exists pgcrypto;

create table public.themes (
  code text primary key,
  name text not null,
  premium_only boolean not null default false,
  active boolean not null default true,
  sort int not null default 0
);
insert into public.themes (code, name, sort) values
  ('classic', 'Classic', 1), ('football', 'Football', 2), ('cricket', 'Cricket', 3), ('geography', 'Geography', 4);

create table public.players (
  id uuid primary key default gen_random_uuid(),
  user_id uuid unique references auth.users(id) on delete cascade,
  nickname text not null unique check (nickname ~ '^[A-Za-z0-9_]{3,20}$'),
  themes text[] not null default '{classic}',
  free_theme text references public.themes(code),
  free_theme_set_at timestamptz,
  market text check (market in ('GB','US','NG','IN')),
  marketing_consent boolean not null default false,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create table public.daily_puzzles (
  id bigint generated always as identity primary key,
  puzzle_date date not null,
  difficulty text not null check (difficulty in ('easy','medium','hard')),
  version int not null default 1,
  puzzle_no int not null,
  size int not null,
  givens smallint[] not null,
  solution smallint[] not null,
  level int not null,
  fingerprint text not null unique,
  status text not null default 'active' check (status in ('active','disabled')),
  disabled_reason text,
  created_at timestamptz not null default now(),
  unique (puzzle_date, difficulty, version)
);
create unique index daily_puzzles_one_active on public.daily_puzzles (puzzle_date, difficulty) where status = 'active';

create table public.attempts (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.players(id) on delete cascade,
  puzzle_id bigint not null references public.daily_puzzles(id) on delete cascade,
  theme text not null references public.themes(code),
  mode text not null check (mode in ('daily','archive')),
  status text not null default 'started' check (status in ('started','completed')),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  hints_used int not null default 0,
  rewarded_hints int not null default 0,
  hinted_cells int[] not null default '{}'
);
create index attempts_player on public.attempts (player_id, started_at desc);
create index attempts_started on public.attempts (started_at);
create index attempts_puzzle on public.attempts (puzzle_id);
-- one daily attempt per player per puzzle
create unique index attempts_one_daily on public.attempts (player_id, puzzle_id) where mode = 'daily';

create table public.scores (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null unique references public.attempts(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,
  puzzle_id bigint not null references public.daily_puzzles(id) on delete cascade,
  puzzle_date date not null,
  difficulty text not null,
  theme text not null,
  score int not null check (score >= 0),
  time_ms int not null check (time_ms >= 0),
  mistakes int not null check (mistakes >= 0),
  hints int not null check (hints >= 0),
  ranked boolean not null,
  row_flags text[] not null default '{}',
  created_at timestamptz not null default now()
);
create unique index scores_one_ranked on public.scores (player_id, puzzle_id) where ranked;
create index scores_board on public.scores (puzzle_date, difficulty, theme) where ranked;
create index scores_player on public.scores (player_id, puzzle_date);
create index scores_puzzle on public.scores (puzzle_id);

create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.players(id) on delete cascade,
  provider text not null check (provider in ('stripe','paystack','razorpay')),
  provider_ref text not null,
  provider_customer text,
  provider_token text,
  plan text not null check (plan in ('monthly','yearly')),
  status text not null,
  currency text not null,
  current_period_end timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, provider_ref)
);
create index subscriptions_player on public.subscriptions (player_id);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  player_id uuid references public.players(id) on delete set null,
  provider text not null,
  provider_ref text not null,
  amount_minor bigint not null,
  currency text not null,
  status text not null,
  created_at timestamptz not null default now(),
  unique (provider, provider_ref)
);
create index payments_player on public.payments (player_id);

create table public.webhook_events (
  provider text not null,
  event_id text not null,
  received_at timestamptz not null default now(),
  primary key (provider, event_id)
);

create table public.achievements (
  player_id uuid not null references public.players(id) on delete cascade,
  code text not null,
  earned_at timestamptz not null default now(),
  primary key (player_id, code)
);

create table public.groups (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null check (char_length(name) between 3 and 40),
  owner_id uuid not null references public.players(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index groups_owner on public.groups (owner_id);
create table public.group_members (
  group_id uuid not null references public.groups(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (group_id, player_id)
);
create index group_members_player on public.group_members (player_id);

-- Share events and product analytics (only recorded with the player's analytics consent).
create table public.analytics_events (
  id bigint generated always as identity primary key,
  player_id uuid references public.players(id) on delete cascade,
  event text not null,
  props jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index analytics_events_event on public.analytics_events (event, created_at);
create index analytics_events_player on public.analytics_events (player_id);

create table public.reports (
  id uuid primary key default gen_random_uuid(),
  player_id uuid references public.players(id) on delete set null,
  puzzle_id bigint references public.daily_puzzles(id) on delete set null,
  message text not null check (char_length(message) between 3 and 1000),
  status text not null default 'open' check (status in ('open','resolved')),
  created_at timestamptz not null default now()
);
create index reports_player on public.reports (player_id);
create index reports_puzzle on public.reports (puzzle_id);

-- ---------- Lock down ----------
do $$
declare t text;
begin
  foreach t in array array['themes','players','daily_puzzles','attempts','scores','subscriptions','payments',
    'webhook_events','achievements','groups','group_members','analytics_events','reports'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;

-- ---------- Server-side query functions ----------
create or replace function public.leaderboard(
  p_from date, p_to date, p_difficulty text, p_theme text, p_group uuid, p_player uuid, p_limit int default 50)
returns table (rank bigint, player_id uuid, nickname text, total_score bigint, total_time bigint, total_mistakes bigint, plays bigint, total_players bigint)
language sql stable security definer set search_path = public as $$
  with agg as (
    select s.player_id, sum(s.score)::bigint ts, sum(s.time_ms)::bigint tt, sum(s.mistakes)::bigint tm, count(*)::bigint n
    from scores s
    where s.ranked and s.puzzle_date between p_from and p_to
      and (p_difficulty is null or s.difficulty = p_difficulty)
      and (p_theme is null or s.theme = p_theme)
      and (p_group is null or exists (select 1 from group_members gm where gm.group_id = p_group and gm.player_id = s.player_id))
    group by s.player_id
  ), ranked as (
    select rank() over (order by ts desc, tt asc, tm asc) r, a.*, count(*) over () total from agg a
  )
  select r, ranked.player_id, p.nickname, ts, tt, tm, n, total
  from ranked join players p on p.id = ranked.player_id
  where r <= p_limit or ranked.player_id = p_player
  order by r, p.nickname;
$$;

create or replace function public.player_stats(p_player uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'completed', (select count(*) from scores where player_id = p_player),
    'avg_time_ms', (select coalesce(avg(time_ms)::bigint, 0) from scores where player_id = p_player),
    'by_difficulty', coalesce((select jsonb_object_agg(difficulty, x) from (
        select difficulty, jsonb_build_object('plays', count(*), 'avg_time_ms', avg(time_ms)::bigint,
          'best_time_ms', min(time_ms), 'avg_mistakes', round(avg(mistakes), 2), 'best_score', max(score),
          'flawless', count(*) filter (where mistakes = 0 and hints = 0)) x
        from scores where player_id = p_player group by difficulty) d), '{}'),
    'by_theme', coalesce((select jsonb_object_agg(theme, c) from (
        select theme, count(*) c from scores where player_id = p_player group by theme) t), '{}'),
    'time_buckets', coalesce((select jsonb_object_agg(b, c) from (
        select case when time_ms < 60000 then 'under_1m' when time_ms < 180000 then '1_3m'
                    when time_ms < 600000 then '3_10m' else 'over_10m' end b, count(*) c
        from scores where player_id = p_player group by 1) t), '{}'),
    'recent', coalesce((select jsonb_agg(r) from (
        select puzzle_date, difficulty, theme, score, time_ms, mistakes from scores
        where player_id = p_player order by created_at desc limit 14) r), '[]')
  );
$$;

create or replace function public.admin_metrics()
returns jsonb language sql stable security definer set search_path = public as $$
  with act as (
    select distinct player_id, (started_at at time zone 'utc')::date d from attempts
  ), firsts as (
    select player_id, min(d) f from act group by player_id
  ), ret as (
    select n, round(100.0 * count(*) filter (where exists (
             select 1 from act a where a.player_id = firsts.player_id and a.d = firsts.f + n))
           / nullif(count(*), 0), 1) pct
    from firsts, (values (1), (7), (30)) v(n)
    where firsts.f <= (now() at time zone 'utc')::date - n
    group by n
  )
  select jsonb_build_object(
    'dau', coalesce((select jsonb_agg(x order by x->>'d') from (
        select jsonb_build_object('d', d, 'players', count(*)) x from act
        where d > (now() at time zone 'utc')::date - 30 group by d) t), '[]'),
    'mau', (select count(distinct player_id) from act where d > (now() at time zone 'utc')::date - 30),
    'players_total', (select count(*) from players),
    'accounts_total', (select count(*) from players where user_id is not null),
    'sessions_per_player_30d', (select round(count(*)::numeric / nullif(count(distinct player_id), 0), 2)
        from attempts where started_at > now() - interval '30 days'),
    'completion_rate_30d', (select round(100.0 * count(*) filter (where status = 'completed') / nullif(count(*), 0), 1)
        from attempts where started_at > now() - interval '30 days'),
    'avg_time_ms', coalesce((select jsonb_object_agg(difficulty, t) from (
        select difficulty, avg(time_ms)::bigint t from scores where created_at > now() - interval '30 days' group by 1) z), '{}'),
    'retention', coalesce((select jsonb_object_agg('d' || n, pct) from ret), '{}'),
    'theme_popularity', coalesce((select jsonb_object_agg(theme, c) from (
        select theme, count(*) c from scores where created_at > now() - interval '30 days' group by 1) z), '{}'),
    'share_rate_30d', (select round(100.0 *
        (select count(*) from analytics_events where event = 'share_completed' and created_at > now() - interval '30 days')
        / nullif((select count(*) from scores where created_at > now() - interval '30 days'), 0), 1)),
    'hint_usage_30d', (select round(avg(hints), 2) from scores where created_at > now() - interval '30 days'),
    'subscriptions_active', coalesce((select jsonb_object_agg(provider, c) from (
        select provider, count(*) c from subscriptions where status in ('active','trialing','non_renewing')
          and current_period_end > now() group by 1) z), '{}'),
    'subscription_conversion', (select round(100.0 * count(distinct player_id) / nullif((select count(*) from players), 0), 2)
        from subscriptions where status in ('active','trialing','non_renewing') and current_period_end > now()),
    'revenue_30d', coalesce((select jsonb_object_agg(currency, amt) from (
        select currency, sum(amount_minor) amt from payments where status = 'succeeded'
          and created_at > now() - interval '30 days' group by 1) z), '{}'),
    'open_reports', (select count(*) from reports where status = 'open')
  );
$$;

revoke all on function public.leaderboard(date, date, text, text, uuid, uuid, int) from public, anon, authenticated;
revoke all on function public.player_stats(uuid) from public, anon, authenticated;
revoke all on function public.admin_metrics() from public, anon, authenticated;
grant execute on function public.leaderboard(date, date, text, text, uuid, uuid, int) to service_role;
grant execute on function public.player_stats(uuid) to service_role;
grant execute on function public.admin_metrics() to service_role;
