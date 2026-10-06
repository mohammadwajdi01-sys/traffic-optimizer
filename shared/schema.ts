import { z } from "zod";
import { isWindowPlan, selectedWindow } from "./windows";
export const locationSchema = z.object({
  id: z.string().max(150).optional(),
  displayName: z.string().min(1).max(250),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  countryCode: z.string().length(2).optional(),
  timezone: z.string().max(80).optional(),
  source: z.enum(["geoapify", "gps", "manual", "demo"]).optional(),
});
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
export const planSchema = z
  .object({
    origin: locationSchema,
    destination: locationSchema,
    mode: z.enum(["arrive_between", "leave_between", "arrive_by", "leave_around", "avoid_traffic"]),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).or(z.literal("")).optional(),
    time,
    timezone: z.string().min(1).max(80),
    flexibilityMinutes: z.number().int().min(15).max(180),
    safetyBufferMinutes: z.number().int().min(0).max(60),
    maxEarlinessMinutes: z.number().int().min(30).max(360),
    earliestTime: time,
    latestTime: time,
    preferredArrivalStart: time.optional(),
    earliestArrival: time.optional(),
    demo: z.boolean().optional(),
    turnstileToken: z.string().max(2048).optional(),
  })
  .superRefine((p, c) => {
    if (isWindowPlan(p)) {
      try { selectedWindow(p); }
      catch (e) { c.addIssue({code: "custom", path: ["latestTime"], message: (e as Error).message}); }
    }
    if (p.origin.timezone && p.timezone !== p.origin.timezone)
      c.addIssue({
        code: "custom",
        path: ["timezone"],
        message: "Use the origin timezone.",
      });
    if (
      p.origin.latitude === p.destination.latitude &&
      p.origin.longitude === p.destination.longitude
    )
      c.addIssue({
        code: "custom",
        path: ["destination"],
        message: "Choose different locations.",
      });
  });
export const routeSchema = z.object({
  name: z.string().trim().min(1).max(100),
  plan: planSchema,
  days: z.array(z.number().int().min(0).max(6)).min(1).max(7),
  reminders: z.boolean(),
});
