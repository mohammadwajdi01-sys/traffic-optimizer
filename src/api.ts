import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { AppConfig } from "../shared/types";
export let supabase: SupabaseClient | null = null;
export class ApiFailure extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export function configureAuth(c: AppConfig) {
  if (c.supabaseUrl && c.supabaseKey && !supabase)
    supabase = createClient(c.supabaseUrl, c.supabaseKey);
}
export async function api<T>(
  path: string,
  body?: unknown,
  method?: string,
): Promise<T> {
  const { data } = supabase
    ? await supabase.auth.getSession()
    : { data: { session: null } };
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (data.session)
    headers.Authorization = `Bearer ${data.session.access_token}`;
  const res = await fetch(path, {
    method: method ?? (body === undefined ? "GET" : "POST"),
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = (await res.json()) as any;
  if (!res.ok)
    throw new ApiFailure(res.status, json.error ?? "Request failed.");
  return json;
}
export function navUrl(
  provider: "google" | "waze",
  origin: { latitude: number; longitude: number },
  destination: { latitude: number; longitude: number },
) {
  if (provider === "waze")
    return `https://www.waze.com/ul?ll=${destination.latitude}%2C${destination.longitude}&navigate=yes`;
  const q = new URLSearchParams({
    api: "1",
    origin: `${origin.latitude},${origin.longitude}`,
    destination: `${destination.latitude},${destination.longitude}`,
    travelmode: "driving",
    dir_action: "navigate",
  });
  return `https://www.google.com/maps/dir/?${q}`;
}
