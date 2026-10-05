-- Traffic Optimizer: isolated application schema; no traffic-provider payload storage.
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table public.profiles (
 id uuid primary key references auth.users(id) on delete cascade,
 role text not null default 'user' check (role in ('user','family','admin')),
 display_name text not null default '' check (length(display_name)<=100),
 created_at timestamptz not null default now()
);
create table public.user_preferences (
 user_id uuid primary key references public.profiles(id) on delete cascade,
 locale text not null default 'en' check(locale in ('en','ar')),
 navigation text not null default 'ask' check(navigation in ('ask','google','waze')),
 safety_buffer int not null default 10 check(safety_buffer between 0 and 60),
 measurement_opt_in boolean not null default false
);
create table public.saved_locations (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references public.profiles(id) on delete cascade,
 label text not null check(length(label) between 1 and 100),
 location_type text not null check(location_type in ('fixed','current_location')),
 latitude double precision check(latitude between -90 and 90),
 longitude double precision check(longitude between -180 and 180),
 timezone text,
 created_at timestamptz not null default now(),
 check(location_type='current_location' or (latitude is not null and longitude is not null))
);
create table public.saved_routes (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references public.profiles(id) on delete cascade,
 name text not null check(length(name) between 1 and 100),
 plan jsonb not null check(jsonb_typeof(plan)='object' and octet_length(plan::text)<=8000 and plan ? 'origin' and plan ? 'destination' and plan ? 'timezone'),
 days integer[] not null default array[0,1,2,3,4] check(cardinality(days) between 1 and 7 and days <@ array[0,1,2,3,4,5,6]),
 reminders boolean not null default false,
 created_at timestamptz not null default now(),
 unique(id,user_id)
);
create index saved_routes_user_id on public.saved_routes(user_id);
create table public.route_schedules (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references public.profiles(id) on delete cascade,
 saved_route_id uuid not null,
 day_of_week int not null check(day_of_week between 0 and 6),
 target_local_time time not null,
 enabled boolean not null default true,
 foreign key(saved_route_id,user_id) references public.saved_routes(id,user_id) on delete cascade
);
create index route_schedules_user_id on public.route_schedules(user_id);
create table public.notification_preferences (
 user_id uuid primary key references public.profiles(id) on delete cascade,
 best_time_reminders boolean not null default false,
 traffic_change_alerts boolean not null default false
);
create table public.push_subscriptions (
 user_id uuid primary key references public.profiles(id) on delete cascade,
 subscription jsonb not null check(jsonb_typeof(subscription)='object' and octet_length(subscription::text)<=4000),
 created_at timestamptz not null default now()
);
create table public.actual_trip_samples (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references public.profiles(id) on delete cascade,
 actual_departure timestamptz not null,
 actual_arrival timestamptz not null,
 actual_duration_seconds int not null check(actual_duration_seconds between 1 and 86400),
 created_at timestamptz not null default now(),
 check(actual_arrival>actual_departure)
);
create index actual_trip_samples_user_id on public.actual_trip_samples(user_id);
-- Internal jobs are denied to browser roles. A small fair queue prevents per-cron fan-out.
create table public.notification_jobs (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references public.profiles(id) on delete cascade,
 route_id uuid not null unique,
 next_attempt_at timestamptz not null default now(),
 foreign key(route_id,user_id) references public.saved_routes(id,user_id) on delete cascade
);
create index notification_jobs_due on public.notification_jobs(next_attempt_at);

alter table public.profiles enable row level security;
create policy profile_read on public.profiles for select to authenticated using ((select auth.uid())=id);
-- Role is server-owned. No user can promote themselves.
grant select on public.profiles to authenticated;
revoke insert,update,delete on public.profiles from anon,authenticated;
grant update(display_name) on public.profiles to authenticated;
create policy profile_display_name on public.profiles for update to authenticated using ((select auth.uid())=id) with check ((select auth.uid())=id);

do $$ declare t text; begin
 foreach t in array array['user_preferences','saved_locations','saved_routes','route_schedules','notification_preferences','push_subscriptions','actual_trip_samples'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('create policy own_read on public.%I for select to authenticated using ((select auth.uid())=user_id)',t);
  execute format('create policy own_insert on public.%I for insert to authenticated with check ((select auth.uid())=user_id)',t);
  execute format('create policy own_update on public.%I for update to authenticated using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id)',t);
  execute format('create policy own_delete on public.%I for delete to authenticated using ((select auth.uid())=user_id)',t);
  execute format('grant select,insert,update,delete on public.%I to authenticated',t);
  execute format('revoke all on public.%I from anon',t);
 end loop;
end $$;
alter table public.notification_jobs enable row level security;
revoke all on public.notification_jobs from anon,authenticated;
grant all on all tables in schema public to service_role;

-- Necessary privileged auth trigger: private schema, fixed search_path, not publicly executable.
create function private.new_user() returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into public.profiles(id) values(new.id);
 insert into public.user_preferences(user_id) values(new.id);
 insert into public.notification_preferences(user_id) values(new.id);
 return new;
end $$;
revoke all on function private.new_user() from public,anon,authenticated;
create trigger traffic_new_user after insert on auth.users for each row execute function private.new_user();

create function private.check_route_limit() returns trigger language plpgsql security invoker set search_path='' as $$
declare lim int; n int;
begin
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(new.user_id::text));
 select case role when 'admin' then 100 when 'family' then 20 else 3 end into lim from public.profiles where id=new.user_id;
 select count(*) into n from public.saved_routes where user_id=new.user_id;
 if n>=coalesce(lim,3) then raise exception 'saved route allowance reached';end if;
 return new;
end $$;
revoke all on function private.check_route_limit() from public,anon,authenticated;
create trigger traffic_route_limit before insert on public.saved_routes for each row execute function private.check_route_limit();

create function private.queue_reminder() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.reminders then
  insert into public.notification_jobs(user_id,route_id) values(new.user_id,new.id) on conflict(route_id) do update set next_attempt_at=now();
 else delete from public.notification_jobs where route_id=new.id;
 end if;
 return new;
end $$;
revoke all on function private.queue_reminder() from public,anon,authenticated;
create trigger traffic_route_reminder after insert or update of reminders on public.saved_routes for each row execute function private.queue_reminder();

create function private.trip_opt_in() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if not exists(select 1 from public.user_preferences where user_id=new.user_id and measurement_opt_in=true) then raise exception 'measurement consent required';end if;
 return new;
end $$;
revoke all on function private.trip_opt_in() from public,anon,authenticated;
create trigger traffic_trip_opt_in before insert or update on public.actual_trip_samples for each row execute function private.trip_opt_in();
