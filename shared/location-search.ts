import { z } from "zod";

// ISO 3166-1 alpha-2 regions; shared by the selector and server validation.
export const countryCodes = "AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW".split(" ");
export function countryCode(value: unknown): string | undefined {
  if (typeof value !== "string") return;
  const code = value.toUpperCase();
  return countryCodes.includes(code) ? code : undefined;
}
export const locationSearchSchema = z.object({
  text: z.string().trim().min(3).max(200).optional(),
  latitude: z.number().finite().min(-90).max(90).optional(),
  longitude: z.number().finite().min(-180).max(180).optional(),
  countryCode: z.string().transform(v => v.toUpperCase()).refine(v => Boolean(countryCode(v)), "Choose a valid country.").optional(),
  language: z.enum(["en", "ar"]).default("en"),
}).refine(v => (v.latitude === undefined) === (v.longitude === undefined), "Provide both coordinates.");
export function locationQuery(path: string, input: z.infer<typeof locationSearchSchema>, fallbackCountry?: unknown) {
  if (!["/api/location/suggest", "/api/location/reverse"].includes(path)) throw new Error("Unknown location request.");
  const reverse = path.endsWith("reverse"),
    country = countryCode(input.countryCode) ?? countryCode(fallbackCountry),
    query = new URLSearchParams({ lang: input.language, limit: "5" });
  if (reverse) {
    if (input.latitude === undefined || input.longitude === undefined) throw new Error("Coordinates are required.");
    query.set("lat", String(input.latitude));
    query.set("lon", String(input.longitude));
  } else {
    if (!input.text) throw new Error("Type a location.");
    if (!country) throw new Error("Choose your search country or share your location first.");
    query.set("text", input.text);
    query.set("filter", `countrycode:${country.toLowerCase()}`);
    if (input.latitude !== undefined && input.longitude !== undefined) query.set("bias", `proximity:${input.longitude},${input.latitude}`);
    else query.set("bias", `countrycode:${country.toLowerCase()}`);
  }
  return { query, country: reverse ? undefined : country, endpoint: reverse ? "reverse" : "autocomplete" };
}
