import { buildPushPayload } from "@block65/webcrypto-web-push";
import { db } from "./database";
import { budget, type Env } from "./env";
import { createForecast } from "./providers";
import { optimize } from "../shared/optimizer";
import { addDays, clock, localDate, localInstant } from "../shared/time";
import type { Plan, SavedRoute } from "../shared/types";
import { planSchema } from "../shared/schema";
export async function scheduledReminders(env: Env) {
  if (
    env.APP_MODE !== "live" ||
    !env.SUPABASE_SECRET_KEY ||
    !env.VAPID_PRIVATE_KEY ||
    !env.VAPID_PUBLIC_KEY ||
    !env.VAPID_SUBJECT
  )
    return;
  const now = Date.now();
  const jobs = (await db(
    env,
    `notification_jobs?next_attempt_at=lte.${encodeURIComponent(new Date(now).toISOString())}&select=id,user_id,route_id,saved_routes(*)&order=next_attempt_at&limit=4`,
    { service: true },
  )) as any[];
  for (const job of jobs) {
    let next = now + 3600000;
    try {
      const route = job.saved_routes as SavedRoute;
      if (!route?.reminders) continue;
      const date = localDate(now, route.plan.timezone),
        weekday = new Date(date + "T12:00Z").getUTCDay();
      if (!route.days.includes(weekday)) {
        next = localInstant(addDays(date, 1), "00:05", route.plan.timezone);
        continue;
      }
      const p: Plan = planSchema.parse({ ...route.plan, date, demo: false });
      const target = localInstant(
        date,
        p.mode === "avoid_traffic" ? p.earliestTime : p.time,
        p.timezone,
      );
      if (now < target - 120 * 60000) {
        next = target - 120 * 60000;
        continue;
      }
      if (now > target + 10 * 60000) {
        next = localInstant(addDays(date, 1), "00:05", p.timezone);
        continue;
      }
      next = now + 10 * 60000;
      const key = `${job.route_id}:${date}:${Math.floor(now / (30 * 60000))}`;
      if (!(await budget(env, "/once", { key })).claimed) continue;
      const subscriptions = (await db(
        env,
        `push_subscriptions?user_id=eq.${job.user_id}&select=subscription&limit=1`,
        { service: true },
      )) as any[];
      if (!subscriptions.length) {
        next = now + 86400000;
        continue;
      }
      const forecast = await createForecast(env, p, false),
        analysis = await optimize(p, forecast, { maxCalls: 6 });
      const best = analysis.best;
      if (!best || Date.parse(best.departureAt) > now + 60 * 60000) continue;
      const payload = await buildPushPayload(
        {
          data: {
            title: "Traffic Optimizer",
            body: `Check your ${route.name} journey. Best tested departure: ${clock(best.departureAt, p.timezone)}. Expected drive: ${Math.round(best.durationSeconds / 60)} min.`,
            url: "/plan",
          },
          options: { ttl: 600 },
        },
        subscriptions[0].subscription,
        {
          subject: env.VAPID_SUBJECT,
          publicKey: env.VAPID_PUBLIC_KEY,
          privateKey: env.VAPID_PRIVATE_KEY,
        },
      );
      const res = await fetch(subscriptions[0].subscription.endpoint, {
        ...payload,
        signal: AbortSignal.timeout(10000),
        redirect: "error",
      });
      if (res.status === 404 || res.status === 410)
        await db(env, `push_subscriptions?user_id=eq.${job.user_id}`, {
          method: "DELETE",
          service: true,
        });
    } catch {
      await budget(env, "/error", {
        code: "reminder_failed",
        requestId: crypto.randomUUID(),
      }).catch(() => {});
    } finally {
      await db(env, `notification_jobs?id=eq.${job.id}`, {
        method: "PATCH",
        body: { next_attempt_at: new Date(next).toISOString() },
        service: true,
      }).catch(() => {});
    }
  }
}
