# Accounts, roles and the move off localStorage

Status: **planned, not connected.** The role model and every permission check
are live in the app today; there is no backend behind them yet, so nobody can
sign in. This document is the plan for closing that gap.

## Roles

| Role | Can |
| --- | --- |
| **Head coach** | Everything: team, roster, games, settings, and inviting coaches. |
| **Assistant coach** (max 2) | Set where players can and cannot play, and mark core players. Read-only everywhere else. |

The full table is `src/domain/access.ts` — `ROLE_PERMISSIONS`. That file is the
single source of truth and is already used by the UI. **The server must import
the same table.** Hiding a button is a courtesy, not a control.

Two helpers matter for correctness rather than presentation:

- `canInviteAssistant()` returns the coach-facing reason an invite is refused
  (not allowed / at capacity / duplicate / invalid email), so the UI and the
  server give identical answers and the two-assistant cap is enforced in one
  place.
- `permittedPlayerChanges()` narrows a player update to the fields the role may
  change. An assistant's "change the tier" request cannot smuggle a renamed
  player or a flipped `active` flag alongside it. Call this **server-side too** —
  it is the difference between a real restriction and a cosmetic one.

## Why a database is required

Season fairness reads every completed game to compute expected-versus-actual
innings. That is a relational query over a growing history, and several coaches
must see the same data. `localStorage` cannot do either.

## Schema

```sql
-- Supabase provides auth.users; everything below is application data.

create table teams (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  sport           text not null check (sport in ('BASEBALL','SOFTBALL')),
  season_name     text not null default '',
  division        text not null default '',
  default_innings int  not null default 6,
  default_formation_id text not null,
  settings        jsonb not null,
  created_at      timestamptz not null default now()
);

create table team_memberships (
  id         uuid primary key default gen_random_uuid(),
  team_id    uuid not null references teams(id) on delete cascade,
  user_id    uuid references auth.users(id) on delete cascade,
  email      text not null,
  name       text not null default '',
  role       text not null check (role in ('HEAD_COACH','ASSISTANT')),
  status     text not null check (status in ('INVITED','ACTIVE')) default 'INVITED',
  created_at timestamptz not null default now(),
  unique (team_id, email)
);

-- The two-assistant cap, enforced by the database rather than by hope.
create or replace function enforce_assistant_cap() returns trigger as $$
begin
  if new.role = 'ASSISTANT' and (
    select count(*) from team_memberships
    where team_id = new.team_id and role = 'ASSISTANT' and id <> new.id
  ) >= 2 then
    raise exception 'a team may have at most 2 assistant coaches';
  end if;
  return new;
end;
$$ language plpgsql;

create trigger assistant_cap
  before insert or update on team_memberships
  for each row execute function enforce_assistant_cap();

create table players (
  id              uuid primary key default gen_random_uuid(),
  team_id         uuid not null references teams(id) on delete cascade,
  first_name      text not null,
  last_name       text not null default '',
  jersey_number   text,
  active          boolean not null default true,
  overall_tier    text not null default 'REGULAR',
  offensive_tier  text not null default 'REGULAR',
  position_ratings jsonb not null default '{}',
  can_pitch       boolean not null default false,
  can_catch       boolean not null default false,
  preferred_pitcher boolean not null default false,
  preferred_catcher boolean not null default false,
  max_pitching_innings int,
  max_catching_innings int,
  created_at      timestamptz not null default now()
);

-- Games keep their formation and settings snapshots as jsonb: history must not
-- change when team settings later change, which the app already relies on.
create table games (
  id             uuid primary key default gen_random_uuid(),
  team_id        uuid not null references teams(id) on delete cascade,
  opponent       text not null default '',
  date           date not null,
  planned_innings int not null,
  actual_innings int,
  status         text not null default 'PLANNED',
  formation_snapshot jsonb not null,
  settings_snapshot  jsonb not null,
  optimizer_version text not null default '',
  optimizer_seed int not null default 1,
  game_players   jsonb not null default '[]',
  pitching_plan  jsonb not null default '{}',
  eligibility_overrides jsonb not null default '[]',
  created_at     timestamptz not null default now()
);

create table defensive_assignments (
  id          uuid primary key default gen_random_uuid(),
  game_id     uuid not null references games(id) on delete cascade,
  inning      int not null,
  position_id text not null,
  player_id   uuid not null references players(id) on delete cascade,
  locked      boolean not null default false,
  assignment_type text not null check (assignment_type in ('PLANNED','ACTUAL'))
);

create index on defensive_assignments (game_id, assignment_type);

create table batting_assignments (
  game_id      uuid not null references games(id) on delete cascade,
  player_id    uuid not null references players(id) on delete cascade,
  batting_slot int not null,
  locked       boolean not null default false,
  primary key (game_id, player_id)
);

create table development_goals (
  id         uuid primary key default gen_random_uuid(),
  team_id    uuid not null references teams(id) on delete cascade,
  player_id  uuid not null references players(id) on delete cascade,
  position_id text,
  position_group text,
  goal_type  text not null,
  priority   int not null default 2,
  active     boolean not null default true
);

create table priority_flags (
  id         uuid primary key default gen_random_uuid(),
  team_id    uuid not null references teams(id) on delete cascade,
  player_id  uuid not null references players(id) on delete cascade,
  kind       text not null,
  created_at timestamptz not null default now()
);
```

## Row Level Security

RLS is what makes the assistant restriction real. With these policies an
assistant could call the API directly with a renamed player and the database
would still refuse.

```sql
alter table teams                 enable row level security;
alter table team_memberships      enable row level security;
alter table players               enable row level security;
alter table games                 enable row level security;
alter table defensive_assignments enable row level security;
alter table batting_assignments   enable row level security;
alter table development_goals     enable row level security;
alter table priority_flags        enable row level security;

create or replace function my_role(target_team uuid) returns text as $$
  select role from team_memberships
  where team_id = target_team and user_id = auth.uid() and status = 'ACTIVE'
  limit 1;
$$ language sql stable security definer;

-- Read: any active member of the team, for every table.
create policy read_team on teams for select using (my_role(id) is not null);
create policy read_players on players for select using (my_role(team_id) is not null);
create policy read_games on games for select using (my_role(team_id) is not null);

-- Write: the head coach only.
create policy write_team on teams for update using (my_role(id) = 'HEAD_COACH');
create policy write_games on games for all using (my_role(team_id) = 'HEAD_COACH');
create policy insert_players on players for insert with check (my_role(team_id) = 'HEAD_COACH');
create policy delete_players on players for delete using (my_role(team_id) = 'HEAD_COACH');
create policy manage_members on team_memberships for all using (my_role(team_id) = 'HEAD_COACH');

/*
  Players are the one table both roles write, so the column list is the policy.
  Postgres has no per-column UPDATE restriction in RLS, so an assistant's write
  goes through a function that accepts only the delegated fields. The route
  handler also calls permittedPlayerChanges(); this is the backstop.
*/
create policy update_players_head on players for update
  using (my_role(team_id) = 'HEAD_COACH');

create or replace function assistant_update_player(
  target_player uuid,
  new_position_ratings jsonb,
  new_overall_tier text,
  new_can_pitch boolean,
  new_can_catch boolean
) returns void as $$
declare target_team uuid;
begin
  select team_id into target_team from players where id = target_player;
  if my_role(target_team) not in ('HEAD_COACH','ASSISTANT') then
    raise exception 'not a member of this team';
  end if;

  update players set
    position_ratings = coalesce(new_position_ratings, position_ratings),
    overall_tier     = coalesce(new_overall_tier, overall_tier),
    can_pitch        = coalesce(new_can_pitch, can_pitch),
    can_catch        = coalesce(new_can_catch, can_catch)
  where id = target_player;
end;
$$ language plpgsql security definer;
```

## Migration from this device

Existing teams live in `localStorage` under `dugout.db.v1`. On first sign-in,
offer to upload it:

1. Read the local database.
2. Create the team, then a `HEAD_COACH` membership for the signed-in user.
3. Insert players, keeping a local-id → new-uuid map.
4. Insert games with their snapshots, remapping player ids in assignments.
5. Mark the local database as migrated rather than deleting it, so a failed
   upload is never a lost season.

Season statistics recompute from the migrated games, so nothing needs
translating — `getPlayerSeasonUsage` and `getFairnessDebt` read whatever games
exist.

## What this costs

Nothing, at this size. Supabase's free tier (500 MB database, 50k monthly
active users) is far beyond a few coaches and a season of games, and Netlify's
free tier already hosts the site. The only per-use cost in the product is the
Claude API for roster photo import, which is optional — leave
`ANTHROPIC_API_KEY` unset and that feature explains it is unconfigured while
everything else works.

## Order of work

1. Create the Supabase project; run the schema and policies above.
2. Add a `SupabaseStore` implementing `Repositories` from
   `src/data/repositories.ts`. Nothing in `domain/`, `optimizer/` or
   `services/` should change — that seam is why those interfaces exist.
3. Sign-in screen (magic link is fewest moving parts) and a session provider.
4. Migration prompt described above.
5. Invitation emails, and accepting an invite binds `user_id` to the membership.
6. Apply `permittedPlayerChanges()` in the write path as well as the UI.
