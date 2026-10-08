import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import assert from "node:assert/strict";
const pg = new PGlite();
await pg.exec(
  `create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to authenticated,anon;grant execute on function auth.uid() to authenticated;`,
);
const file = readdirSync("supabase/migrations").find((x) =>
  x.endsWith("_traffic_optimizer_initial.sql"),
);
await pg.exec(readFileSync("supabase/migrations/" + file, "utf8"));
const a = "11111111-1111-4111-8111-111111111111",
  b = "22222222-2222-4222-8222-222222222222";
await pg.exec(`insert into auth.users(id) values('${a}'),('${b}');`);
assert.equal(
  (await pg.query("select count(*)::int as n from profiles")).rows[0].n,
  2,
);
await pg.exec(`set role authenticated;set request.jwt.claim.sub='${a}';`);
assert.equal(
  (await pg.query("select count(*)::int as n from profiles")).rows[0].n,
  1,
);
await assert.rejects(
  pg.exec(`update profiles set role='admin' where id='${a}'`),
);
await assert.rejects(
  pg.exec(
    `insert into saved_routes(user_id,name,plan) values('${b}','Unauthorized','{"origin":{},"destination":{},"timezone":"UTC"}')`,
  ),
);
for (let i = 0; i < 3; i++)
  await pg.exec(
    `insert into saved_routes(user_id,name,plan,reminders) values('${a}','Route ${i}','{"origin":{},"destination":{},"timezone":"UTC"}',true)`,
  );
await assert.rejects(
  pg.exec(
    `insert into saved_routes(user_id,name,plan) values('${a}','Fourth','{"origin":{},"destination":{},"timezone":"UTC"}')`,
  ),
);
await pg.exec(`set request.jwt.claim.sub='${b}';`);
assert.equal(
  (await pg.query("select count(*)::int as n from saved_routes")).rows[0].n,
  0,
);
await assert.rejects(
  pg.exec(
    `insert into actual_trip_samples(user_id,actual_departure,actual_arrival,actual_duration_seconds) values('${b}','2026-10-05T05:00Z','2026-10-05T05:30Z',1800)`,
  ),
);
await pg.exec(
  `update user_preferences set measurement_opt_in=true where user_id='${b}';insert into actual_trip_samples(user_id,actual_departure,actual_arrival,actual_duration_seconds) values('${b}','2026-10-05T05:00Z','2026-10-05T05:30Z',1800);`,
);
await assert.rejects(pg.exec("select * from notification_jobs"));
await pg.exec("reset role");
assert.equal(
  (await pg.query("select count(*)::int as n from notification_jobs")).rows[0]
    .n,
  3,
);
assert.equal((await pg.query("select safety_buffer from user_preferences where user_id='"+b+"'")).rows[0].safety_buffer,10);
await pg.exec(readFileSync("supabase/migrations/20261007190543_zero_new_account_buffer.sql","utf8"));
assert.equal((await pg.query("select safety_buffer from user_preferences where user_id='"+b+"'")).rows[0].safety_buffer,10);
const c="33333333-3333-4333-8333-333333333333";
await pg.exec(`insert into auth.users(id) values('${c}')`);
assert.equal((await pg.query("select safety_buffer from user_preferences where user_id='"+c+"'")).rows[0].safety_buffer,0);
await pg.exec(`insert into push_subscriptions(user_id,subscription) values('${a}','{"endpoint":"https://fcm.googleapis.com/old","keys":{"auth":"a","p256dh":"b"}}')`);
await pg.exec(readFileSync('supabase/migrations/20261008113721_device_reminder_deliveries.sql','utf8'));
assert.equal((await pg.query(`select count(*)::int as n from push_devices where user_id='${a}'`)).rows[0].n,1);
await pg.exec(`set role authenticated;set request.jwt.claim.sub='${a}';insert into push_devices(user_id,subscription) values('${a}','{"endpoint":"https://fcm.googleapis.com/new","keys":{"auth":"a","p256dh":"b"}}');`);
const devices=(await pg.query(`select id from push_devices order by created_at`)).rows;
assert.equal(devices.length,2);
await assert.rejects(pg.exec(`update push_devices set user_id='${b}'`));
await assert.rejects(pg.exec(`insert into reminder_deliveries(user_id,subscription_id,occurrence_key,plan,candidate,locale,due_at,expires_at,next_attempt_at) values('${a}','${devices[0].id}','test','{}','{}','en',now(),now()+interval '1 hour',now())`));
await pg.exec('reset role');
const rid=(await pg.query(`select id from saved_routes where user_id='${a}' limit 1`)).rows[0].id;
await pg.exec(`insert into reminder_deliveries(user_id,subscription_id,route_id,occurrence_key,plan,candidate,locale,due_at,expires_at,next_attempt_at) values('${a}','${devices[0].id}','${rid}','test','{}','{}','en',now(),now()+interval '1 hour',now()),('${a}','${devices[1].id}','${rid}','test','{}','{}','en',now(),now()+interval '1 hour',now());`);
await pg.exec(`set role authenticated;set request.jwt.claim.sub='${b}';`);
assert.equal((await pg.query('select count(*)::int as n from reminder_deliveries')).rows[0].n,0);
await pg.exec(`set request.jwt.claim.sub='${a}';delete from push_devices where id='${devices[0].id}';`);
assert.equal((await pg.query('select count(*)::int as n from push_devices')).rows[0].n,1);
assert.equal((await pg.query('select count(*)::int as n from reminder_deliveries')).rows[0].n,1);
await pg.exec(`update saved_routes set name='Updated' where id='${rid}'`);
assert.equal((await pg.query('select status from reminder_deliveries')).rows[0].status,'cancelled');
await pg.exec('reset role');
// Separate SQL sessions exercise route/preferences persistence and denied cross-owner writes.
// These are database fixtures, not a hosted Auth re-login or real browser acceptance.
await pg.exec(`set role authenticated;set request.jwt.claim.sub='${c}';`);
const saved=(await pg.query(`insert into saved_routes(user_id,name,plan,days,reminders) values('${c}','Disposable acceptance route','{"origin":{"latitude":0,"longitude":0},"destination":{"latitude":1,"longitude":1},"timezone":"Asia/Amman","safetyBufferMinutes":7}',array[1,3],false) returning id`)).rows[0].id;
await pg.exec(`update saved_routes set name='Renamed acceptance route' where id='${saved}';update user_preferences set locale='ar',navigation='waze',safety_buffer=7 where user_id='${c}';reset role;`);
await pg.exec(`set role authenticated;set request.jwt.claim.sub='${b}';`);
assert.equal((await pg.query(`select id from saved_routes where id='${saved}'`)).rows.length,0);
assert.equal((await pg.query(`update saved_routes set name='Unauthorized' where id='${saved}' returning id`)).rows.length,0);
assert.equal((await pg.query(`delete from saved_routes where id='${saved}' returning id`)).rows.length,0);
assert.equal((await pg.query(`update user_preferences set safety_buffer=60 where user_id='${c}' returning user_id`)).rows.length,0);
await pg.exec(`reset role;set role authenticated;set request.jwt.claim.sub='${c}';`);
assert.equal((await pg.query(`select name from saved_routes where id='${saved}'`)).rows[0].name,'Renamed acceptance route');
assert.deepEqual((await pg.query(`select locale,navigation,safety_buffer from user_preferences where user_id='${c}'`)).rows[0],{locale:'ar',navigation:'waze',safety_buffer:7});
await assert.rejects(pg.exec(`update saved_routes set user_id='${b}' where id='${saved}'`));
assert.equal((await pg.query(`delete from saved_routes where id='${saved}' returning id`)).rows.length,1);
assert.equal((await pg.query(`select id from saved_routes where id='${saved}'`)).rows.length,0);
await pg.exec('reset role');
console.log('PASS: owned route create/edit/delete and preference persistence across fixture sessions; foreign reads/updates/deletes and owner reassignment denied.');
await pg.exec(`delete from auth.users where id='${a}'`);
assert.equal(
  (await pg.query("select count(*)::int as n from notification_jobs")).rows[0]
    .n,
  0,
);
console.log(
  "PASS: migration, auth trigger, role protection, cross-user isolation, route cap, consent, private queue, deletion cascade.",
);
await pg.close();
