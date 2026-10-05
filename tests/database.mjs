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
