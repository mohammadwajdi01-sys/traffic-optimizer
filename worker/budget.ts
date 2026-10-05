import { DurableObject } from "cloudflare:workers";
import type { Env } from "./env";
export type ProviderName = "mapbox" | "google" | "geoapify" | "maps";
export type ProviderConfig = {
  enabled: boolean;
  soft: number;
  hard: number;
  free: number;
  pricePerThousand: number;
  period: "day" | "month";
  rpm: number;
};
export const defaults = {
  paid: false,
  monthlyBudget: 0,
  providers: {
    mapbox: {
      enabled: true,
      soft: 90000,
      hard: 98000,
      free: 100000,
      pricePerThousand: 0.75,
      period: "month",
      rpm: 260,
    },
    google: {
      enabled: false,
      soft: 4500,
      hard: 4900,
      free: 5000,
      pricePerThousand: 10,
      period: "month",
      rpm: 60,
    },
    geoapify: {
      enabled: true,
      soft: 2500,
      hard: 2800,
      free: 3000,
      pricePerThousand: 0,
      period: "day",
      rpm: 240,
    },
    maps: {
      enabled: true,
      soft: 45000,
      hard: 48000,
      free: 50000,
      pricePerThousand: 5,
      period: "month",
      rpm: 60,
    },
  } as Record<ProviderName, ProviderConfig>,
  countries: { JO: "mapbox", LY: "mapbox", SA: "mapbox" } as Record<
    string,
    "mapbox" | "google"
  >,
};
export class BudgetLedger extends DurableObject<Env> {
  async fetch(request: Request) {
    const path = new URL(request.url).pathname;
    const data = (await request.json()) as any,
      now = new Date(),
      day = now.toISOString().slice(0, 10),
      month = day.slice(0, 7),
      minute = Math.floor(now.getTime() / 60000);
    return this.ctx.storage.transaction(async (tx) => {
      const cfg =
        (await tx.get<typeof defaults>("config")) ?? structuredClone(defaults);
      const reply = (value: unknown, status = 200) =>
        Response.json(value, { status });
      if (path === "/status") {
        const keys = await tx.list<number>({ prefix: `p:` });
        return reply({
          config: cfg,
          usage: Object.fromEntries(
            [...keys].filter(([k]) => k.includes(day) || k.includes(month)),
          ),
          audit: (await tx.get("audit")) ?? [],
          errors: (await tx.get("errors")) ?? [],
        });
      }
      if (path === "/config") return reply(cfg);
      if (path === "/error") {
        const errors = (await tx.get<any[]>("errors")) ?? [];
        errors.unshift({
          at: now.toISOString(),
          code: String(data.code).slice(0, 60),
          requestId: data.requestId,
        });
        await tx.put("errors", errors.slice(0, 50));
        return reply({ ok: true });
      }
      if (path === "/update") {
        if (typeof data.paid === "boolean") cfg.paid = data.paid;
        if (
          typeof data.monthlyBudget === "number" &&
          data.monthlyBudget >= 0 &&
          data.monthlyBudget <= 1000
        )
          cfg.monthlyBudget = data.monthlyBudget;
        if (data.provider && Object.hasOwn(cfg.providers, data.provider)) {
          const p = cfg.providers[data.provider as ProviderName];
          if (typeof data.enabled === "boolean") p.enabled = data.enabled;
          if (
            Number.isInteger(data.hard) &&
            data.hard >= 0 &&
            data.hard <= 10000000
          )
            p.hard = data.hard;
        }
        if (
          data.country &&
          ["JO", "LY", "SA"].includes(data.country) &&
          ["mapbox", "google"].includes(data.primary)
        )
          cfg.countries[data.country] = data.primary;
        const audit = (await tx.get<any[]>("audit")) ?? [];
        audit.unshift({
          at: now.toISOString(),
          actor: data.actor,
          change: { ...data, actor: undefined },
        });
        await tx.put("audit", audit.slice(0, 100));
        await tx.put("config", cfg);
        return reply(cfg);
      }
      if (path === "/analysis") {
        const key = `u:${day}:${data.user}`,
          used = (await tx.get<number>(key)) ?? 0;
        const limit =
          { guest: 1, user: 10, family: 30, admin: 100 }[
            data.role as "guest"
          ] ?? 1;
        if (used >= limit)
          return reply(
            { error: "Your daily analysis allowance has been reached." },
            429,
          );
        await tx.put(key, used + 1);
        return reply({ used: used + 1, limit });
      }
      if (path === "/rate") {
        const key = `r:${minute}:${data.user}`,
          used = (await tx.get<number>(key)) ?? 0;
        if (used >= 30)
          return reply(
            { error: "Please wait a minute before trying again." },
            429,
          );
        await tx.put(key, used + 1);
        return reply({ ok: true });
      }
      if (path === "/once") {
        const key = `once:${data.key}`;
        if (await tx.get(key)) return reply({ claimed: false });
        await tx.put(key, day);
        return reply({ claimed: true });
      }
      if (path === "/reserve") {
        const p = cfg.providers[data.provider as ProviderName];
        if (!p?.enabled)
          return reply({ error: "This provider is disabled." }, 503);
        const period = p.period === "day" ? day : month,
          key = `p:${data.provider}:${period}`,
          rateKey = `pr:${data.provider}:${minute}`,
          used = (await tx.get<number>(key)) ?? 0,
          rate = (await tx.get<number>(rateKey)) ?? 0;
        const limit = cfg.paid ? p.hard : Math.min(p.free, p.hard);
        if (used >= limit || rate >= p.rpm)
          return reply(
            { error: "The provider usage limit has been reached." },
            429,
          );
        const incremental = used >= p.free ? p.pricePerThousand / 1000 : 0,
          costKey = `cost:${month}`,
          cost = (await tx.get<number>(costKey)) ?? 0;
        if (
          incremental > 0 &&
          (!cfg.paid || cost + incremental > cfg.monthlyBudget)
        )
          return reply(
            { error: "The monthly API spending limit has been reached." },
            429,
          );
        await tx.put(key, used + 1);
        await tx.put(rateKey, rate + 1);
        await tx.put(costKey, cost + incremental);
        return reply({
          used: used + 1,
          softReached: used + 1 >= p.soft,
          cost: cost + incremental,
        });
      }
      if (path === "/cleanup") {
        const all = await tx.list();
        const old: string[] = [];
        for (const [k, v] of all) {
          if (
            (k.startsWith("r:") || k.startsWith("pr:")) &&
            Number(k.split(":").at(-1)) < minute - 5
          )
            old.push(k);
          if (k.startsWith("r:") && Number(k.split(":")[1]) < minute - 5)
            old.push(k);
          if (k.startsWith("u:") && k.split(":")[1] < day) old.push(k);
          if (k.startsWith("once:") && String(v) < day) old.push(k);
          if (k.startsWith("p:") && k.split(":")[2] < month) old.push(k);
          if (k.startsWith("cost:") && k.slice(5) < month) old.push(k);
        }
        if (old.length) await tx.delete([...new Set(old)]);
        return reply({ deleted: old.length });
      }
      return reply({ error: "Not found" }, 404);
    });
  }
}
