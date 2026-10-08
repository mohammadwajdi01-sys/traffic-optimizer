-- Additive rollout: keep the legacy table available for a private code rollback.
create table public.push_devices (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references public.profiles(id) on delete cascade,
 subscription jsonb not null check(jsonb_typeof(subscription)='object' and octet_length(subscription::text)<=4000),
 endpoint_key text generated always as (md5(subscription->>'endpoint')) stored,
 created_at timestamptz not null default now(),
 unique(user_id,endpoint_key),unique(id,user_id),
 check(subscription->>'endpoint' is not null)
);
alter table public.push_devices enable row level security;
create policy own_read on public.push_devices for select to authenticated using ((select auth.uid())=user_id);
create policy own_insert on public.push_devices for insert to authenticated with check ((select auth.uid())=user_id);
create policy own_update on public.push_devices for update to authenticated using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);
create policy own_delete on public.push_devices for delete to authenticated using ((select auth.uid())=user_id);
revoke all on public.push_devices from anon;
grant select,insert,update,delete on public.push_devices to authenticated;
grant all on public.push_devices to service_role;
create index push_devices_owner on public.push_devices(user_id);
insert into public.push_devices(user_id,subscription,created_at) select user_id,subscription,created_at from public.push_subscriptions where subscription->>'endpoint' is not null;
create table public.reminder_deliveries (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references public.profiles(id) on delete cascade,
 subscription_id uuid not null,
 route_id uuid,
 occurrence_key text not null check(length(occurrence_key)<=200),
 plan jsonb not null check(octet_length(plan::text)<=8000),
 candidate jsonb not null check(octet_length(candidate::text)<=2000),
 locale text not null check(locale in ('en','ar')),
 due_at timestamptz not null,
 expires_at timestamptz not null,
 next_attempt_at timestamptz not null,
 attempts integer not null default 0 check(attempts between 0 and 3),
 status text not null default 'pending' check(status in ('pending','sent','expired','failed','cancelled')),
 lease_token uuid,
 lease_until timestamptz not null default '-infinity',
 created_at timestamptz not null default now(),
 foreign key(subscription_id,user_id) references public.push_devices(id,user_id) on delete cascade,
 foreign key(route_id,user_id) references public.saved_routes(id,user_id) on delete cascade,
 unique(subscription_id,occurrence_key),
 check(expires_at>due_at)
);
alter table public.reminder_deliveries enable row level security;
create policy own_read on public.reminder_deliveries for select to authenticated using ((select auth.uid())=user_id);
-- Queue fields are server-owned. The Worker checks identity for writes/cancellation.
revoke all on public.reminder_deliveries from anon,authenticated;
grant select on public.reminder_deliveries to authenticated;
grant all on public.reminder_deliveries to service_role;
create index reminder_deliveries_due on public.reminder_deliveries(status,next_attempt_at);
create index reminder_deliveries_owner on public.reminder_deliveries(user_id);
-- Editing timing must invalidate queued occurrences as well as toggling reminders.
create or replace function private.queue_reminder() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if TG_OP='UPDATE' then
  update public.reminder_deliveries set status='cancelled' where route_id=new.id and status='pending';
 end if;
 if new.reminders then
  insert into public.notification_jobs(user_id,route_id) values(new.user_id,new.id) on conflict(route_id) do update set next_attempt_at=now();
 else delete from public.notification_jobs where route_id=new.id;
 end if;
 return new;
end $$;
revoke all on function private.queue_reminder() from public,anon,authenticated;
drop trigger traffic_route_reminder on public.saved_routes;
create trigger traffic_route_reminder after insert or update of reminders,plan,days,name on public.saved_routes for each row execute function private.queue_reminder();
-- A browser can register at most ten endpoints; concurrent writes are serialized.
create function private.check_push_limit() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(new.user_id::text));
 if (select count(*) from public.push_devices where user_id=new.user_id and endpoint_key<>pg_catalog.md5(new.subscription->>'endpoint'))>=10 then raise exception 'device allowance reached'; end if;
 return new;
end $$;
revoke all on function private.check_push_limit() from public,anon,authenticated;
create trigger traffic_push_limit before insert on public.push_devices for each row execute function private.check_push_limit();
