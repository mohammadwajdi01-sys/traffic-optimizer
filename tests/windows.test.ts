import {describe, it, expect, vi} from "vitest";
import {nextSavedPlan} from "../shared/saved-route";
import {defaultPlan} from "../shared/demo";
import {optimize, feasible, summarize} from "../shared/optimizer";
import {selectedWindow, migratePlan, recurringPlan} from "../shared/windows";
import {weeklyPlans, liveWindow} from "../shared/planning";
import {localInstant, iso} from "../shared/time";
import {planSchema} from "../shared/schema";
import type {Analysis, Candidate, Plan} from "../shared/types";
import {checkedWeekSamples, durationScale, durationLevel, nearestWeekCheck, weeklyInsight, occurrenceMinute} from "../shared/weekly-insights";
import {initialJourney, journeyOptions, rerankAnalysis, recommendationAllowed} from "../shared/journey-options";

const p: Plan = {...defaultPlan(), date: "2026-10-07", earliestTime: "08:00", latestTime: "10:00"};
const now = localInstant(p.date,"04:00",p.timezone);
const time = (hm: string) => localInstant(p.date,hm,p.timezone);
const forecast = (minutes = 30) => vi.fn(async (departureAt: string): Promise<Candidate> => ({departureAt,arrivalAt: iso(Date.parse(departureAt)+minutes*60000),durationSeconds: minutes*60,distanceMeters: 10000,provider: "mapbox",trafficCoverage: "unknown"}));

describe("Weekly checked evidence",()=>{
  const weekDay=(date:string,goal:Plan["goal"]="shortest"):Analysis=>{
    const plan={...p,mode:"leave_between" as const,date,endDate:date,goal};
    const samples=[['08:00',60],['09:02',20],['09:08',25],['10:01',1]].map(([hm,min])=>{const at=localInstant(date,String(hm),plan.timezone);return {departureAt:iso(at),arrivalAt:iso(at+Number(min)*60000),durationSeconds:Number(min)*60,distanceMeters:10000,provider:"mapbox" as const,trafficCoverage:"partial" as const};});
    return {id:date,plan,samples,...summarize(samples,plan),avoid:[],provider:"mapbox",quality:"limited",partial:true,calls:samples.length,createdAt:iso(now),warnings:[],lowestMetric:"duration"};
  };
  const days=["2026-10-07","2026-10-08","2026-10-09"].map(d=>weekDay(d));
  it("preserves all positions, selected weekdays and overnight horizon",()=>{
    const plan={...p,mode:"leave_between" as const,endDate:p.date,demo:true};
    expect(weeklyPlans(plan,now,[1,3,5]).map(d=>d?.date??null)).toEqual(["2026-10-07",null,"2026-10-09",null,null,"2026-10-12",null]);
    expect(weeklyPlans(plan,now,[])).toEqual(Array(7).fill(null));
    const last={...plan,demo:false,date:"2026-10-13",endDate:"2026-10-14",earliestTime:"23:00",latestTime:"05:00"};
    expect(weeklyPlans(last,now,[2])[0]).toBeNull();
  });
  it("uses feasible direct checks within 15 minutes and discloses nearby timestamps",()=>{
    const a=days[0],target=localInstant(a.plan.date,'09:00',a.plan.timezone);
    expect(nearestWeekCheck(a,target)).toMatchObject({checkedAt:target+2*60000,approximate:true});
    expect(nearestWeekCheck(a,target+2*60000)?.approximate).toBe(false);
    expect(nearestWeekCheck(a,target-30*60000)).toBeNull();
    expect(checkedWeekSamples(a)).toHaveLength(3);
    expect(nearestWeekCheck(null,target)).toBeNull();
  });
  it("scales this week's measured provider durations without fixed traffic thresholds",()=>{
    const scale=durationScale(days)!;
    expect(scale).toEqual({min:1200,max:3600});
    expect(durationLevel(1200,scale)).toBe(0);expect(durationLevel(3600,scale)).toBe(3);
    expect(durationScale([null])).toBeNull();expect(durationLevel(900,{min:900,max:900})).toBe(0);
  });
  it("requires three distinct days and compares with the earliest feasible check",()=>{
    expect(weeklyInsight(days.slice(0,2))).toBeNull();
    expect(weeklyInsight([days[0],days[0],days[1]])).toBeNull();
    expect(weeklyInsight([...days,null])).toMatchObject({bucket:540,days:3,checkedDays:3,medianDurationSeconds:1200,medianSavingsSeconds:2400,partial:true,goal:"shortest"});
  });
  it("respects soonest versus shortest when comparing recurring buckets",()=>{
    expect(weeklyInsight(days.map(a=>({...a,plan:{...a.plan,goal:"soonest"}})))).toMatchObject({bucket:480,medianDurationSeconds:3600,medianSavingsSeconds:0,goal:"soonest"});
  });
  it("does not manufacture a shared bucket from different days' best times",()=>{
    const nonmatching=days.map((a,i)=>({...a,samples:[{...a.samples[1],departureAt:iso(Date.parse(a.samples[1].departureAt)+i*20*60000),arrivalAt:iso(Date.parse(a.samples[1].arrivalAt)+i*20*60000)}]}));
    expect(weeklyInsight(nonmatching)).toBeNull();
  });
  it("keeps overnight minutes and withholds unreliable Libya recommendations",()=>{
    expect(occurrenceMinute(iso(localInstant('2026-10-08','00:05',p.timezone)),p)).toBe(1445);
    const libya=days.map(a=>({...a,plan:{...a.plan,timezone:'Africa/Tripoli',origin:{...a.plan.origin,countryCode:'LY'}}}));
    expect(weeklyInsight(libya)).toBeNull();expect(durationScale(libya)).toBeNull();
  });
});

describe("Journey goals and reliability", () => {
  it("switches shortest drive to soonest arrival using the same checks and deterministic ties", async () => {
    const plan={...p,mode:"leave_between" as const};
    const f=vi.fn(async(at:string)=>({...await forecast(Date.parse(at)<time("09:00")?40:15)(at),trafficCoverage:"available" as const}));
    const a=await optimize(plan,f,{now});
    const calls=f.mock.calls.length;
    expect(a.best?.departureAt).toBe(iso(time("10:00")));
    const ranked=rerankAnalysis(a,"soonest");
    expect(ranked.best?.departureAt).toBe(iso(time("08:00")));
    expect(ranked.samples).toBe(a.samples);
    expect(ranked.calls).toBe(a.calls);
    expect(f.mock.calls).toHaveLength(calls);
    expect(calls).toBeLessThanOrEqual(24);
    expect(rerankAnalysis(ranked,undefined).best).toEqual(a.best);
    expect(planSchema.safeParse(plan).success).toBe(true);
  });
  it("deduplicates identical alternatives and never auto-selects an infeasible low estimate", async () => {
    const a=await optimize(p,forecast(),{now});
    const options=journeyOptions(a);
    expect(new Set(options.map(r=>r.candidate.provider+":"+r.candidate.departureAt)).size).toBe(options.length);
    expect(options.some(r=>r.labels.length>1)).toBe(true);
    const impossible={...a,plan:{...p,earliestTime:"11:00",latestTime:"12:00"},best:null};
    expect(initialJourney(impossible)).toBeNull();
    expect(journeyOptions(impossible)).toEqual([]);
  });
  it("reserves the arrival-window-start alternative for arrival modes",async()=>{
    const arrival=await optimize(p,forecast(),{now});
    expect(journeyOptions(arrival).some(row=>row.labels.includes('start'))).toBe(true);
    const leaving=await optimize({...p,mode:'leave_between'},forecast(),{now});
    const options=journeyOptions(leaving);
    expect(options.some(row=>row.labels.includes('soonest'))).toBe(true);
    expect(options.every(row=>!row.labels.includes('start'))).toBe(true);
  });
  it("keeps Libya samples inspectable but withholds automatic recommendations even with annotations", async () => {
    const ly={...p,origin:{...p.origin,countryCode:"LY"}};
    const a=await optimize(ly,async at=>({...await forecast()(at),trafficCoverage:"available"}),{now});
    expect(a.samples.length).toBeGreaterThan(1);
    expect(a.best).toBeNull();expect(a.latest).toBeNull();expect(a.earliest).toBeNull();expect(a.lowest).toBeNull();
    expect(initialJourney(a)).toBeNull();expect(journeyOptions(a)).toEqual([]);
    expect(a.warnings.join(" ")).toContain("unvalidated");
    expect(a.warnings.join(" ")).not.toContain("No tested departure");
    expect(recommendationAllowed({...p,timezone:"Africa/Tripoli"})).toBe(false);
  });
});

describe("Two-mode windows", () => {
  it("derives departures before 8 for an 8–10 arrival window, including both boundaries", async () => {
    const a = await optimize(p,forecast(),{now});
    expect(a.best).not.toBeNull();
    expect(a.earliest?.arrivalAt).toBe(iso(time("08:00")));
    expect(a.earliest?.departureAt).toBe(iso(time("07:30")));
    expect(a.latest?.arrivalAt).toBe(iso(time("10:00")));
    expect(a.searchWindow).toEqual([iso(time("07:30")),iso(time("09:30"))]);
    expect(a.samples.filter(c => c.feasible).every(c => Date.parse(c.arrivalAt)>=time("08:00") && Date.parse(c.arrivalAt)<=time("10:00"))).toBe(true);
  });
  it("never recommends a departure outside a departure window",async () => {
    const a=await optimize({...p,mode:"leave_between"},forecast(),{now});
    expect(a.samples.every(c=>Date.parse(c.departureAt)>=time("08:00") && Date.parse(c.departureAt)<=time("10:00"))).toBe(true);
    expect(a.latest).toBeNull();
    expect(a.samples.some(c=>c.departureAt===iso(time("08:00")))).toBe(true);
    expect(a.samples.some(c=>c.departureAt===iso(time("10:00")))).toBe(true);
  });
  it("chooses minimum duration without an early-arrival penalty; ties choose latest", () => {
    const c=(hm:string,minutes:number):Candidate=>({departureAt:iso(time(hm)),arrivalAt:iso(time(hm)+minutes*60000),durationSeconds:minutes*60,distanceMeters:1,provider:"mapbox",trafficCoverage:"unknown"});
    expect(summarize([c("07:50",10),c("09:00",35)],p).best?.durationSeconds).toBe(600);
    expect(summarize([c("07:50",10),c("09:00",10)],p).best?.departureAt).toBe(iso(time("09:00")));
  });
  it("respects both arrival bounds and an explicitly selected allowance",async () => {
    const a=await optimize({...p,safetyBufferMinutes:10},forecast(),{now});
    expect(a.latest?.arrivalAt).toBe(iso(time("09:50")));
    expect(feasible({departureAt:iso(time("07:00")),arrivalAt:iso(time("07:30"))} as Candidate,p)).toBe(false);
  });
  it("covers a 13-hour interval and refines actual timestamps to the minute without exceeding 24 requests",async () => {
    const f=forecast();
    const a=await optimize({...p,mode:"leave_between",earliestTime:"10:00",latestTime:"23:00"},f,{now});
    expect(f.mock.calls.length).toBeLessThanOrEqual(24);
    expect(a.samples.some(c=>c.departureAt===iso(time("10:00")))).toBe(true);
    expect(a.samples.some(c=>c.departureAt===iso(time("23:00")))).toBe(true);
    expect(a.samples.some(c=>Date.parse(c.departureAt)%300000!==0)).toBe(true);
    expect(a.warnings.join(" ")).toContain("checked directly");
  });
  it("never exceeds an explicitly smaller reminder budget",async () => {
    const f=forecast(); await optimize(p,f,{now,maxCalls:6});
    expect(f.mock.calls.length).toBeLessThanOrEqual(6);
  });
  it("deduplicates calls and returns usable partial results when one forecast fails",async () => {
    const f=forecast(); let n=0;
    const called:string[]=[];
    const a=await optimize({...p,mode:"leave_between"},async at=>{called.push(at); if(++n===4)throw new Error("failure"); return f(at);},{now});
    expect(new Set(called).size).toBe(called.length);
    expect(a.best).not.toBeNull(); expect(a.partial).toBe(true); expect(a.failedDepartures).toHaveLength(1);
  });
  it("retries a different boundary when the first provider estimate is unavailable",async () => {
    const f=forecast();let n=0;
    const a=await optimize(p,at=>++n===1?Promise.reject(new Error("failure")):f(at),{now});
    expect(a.best).not.toBeNull(); expect(a.partial).toBe(true);
  });
  it("rejects reversed, invalid calendar/timezone and overly wide windows before calling a provider",async () => {
    for(const patch of [{earliestTime:"11:00",latestTime:"08:00"},{date:"2026-02-30"},{timezone:"invalid",origin:{...p.origin,timezone:"invalid"}},{endDate:"2026-10-09"}]) {
      const f=forecast(); expect(planSchema.safeParse({...p,...patch}).success).toBe(false);
      await expect(optimize({...p,...patch},f,{now})).rejects.toThrow(); expect(f).not.toHaveBeenCalled();
    }
  });
  it("supports explicit overnight windows and shifts both dates in recurring/weekly plans", () => {
    const overnight={...p,mode:"leave_between" as const,endDate:"2026-10-08",earliestTime:"23:00",latestTime:"01:00"};
    expect(selectedWindow(overnight)[1]-selectedWindow(overnight)[0]).toBe(2*3600000);
    expect(recurringPlan(overnight,"2026-10-10").endDate).toBe("2026-10-11");
    expect(weeklyPlans({...overnight,demo:true},now)[1]?.endDate).toBe("2026-10-09");
  });
  it("keeps the full upper bound within the provider horizon",()=>{
    expect(()=>liveWindow(p,time("09:00")-7*86400000)).toThrow("seven days");
  });
  it("migrates all legacy modes without losing locations or departure bounds",()=>{
    const legacy={...p,mode:"avoid_traffic" as const,earliestTime:"09:00",latestTime:"11:00"};
    expect(migratePlan(legacy)).toMatchObject({mode:"leave_between",earliestTime:"09:00",latestTime:"11:00",origin:p.origin});
    expect(migratePlan({...p,mode:"arrive_by",time:"09:00"})).toMatchObject({mode:"arrive_between",earliestTime:"08:00",latestTime:"09:00"});
    expect(migratePlan({...p,mode:"leave_around",time:"00:30",flexibilityMinutes:60})).toMatchObject({mode:"leave_between",date:"2026-10-06",endDate:"2026-10-07",earliestTime:"23:30",latestTime:"01:30"});
  });
});


describe("Saved-route occurrences", () => {
  it("reuses today's remaining window and advances only after it ends", () => {
    const route = {id: "saved", name: "Home", plan: p, days: [], reminders: false};
    expect(nextSavedPlan(route, time("09:00")).date).toBe(p.date);
    expect(nextSavedPlan(route, time("11:00")).date).toBe("2026-10-08");
  });
  it("respects recurring weekdays and retains saved bounds without mutating them", () => {
    const route = {id: "saved", name: "Home", plan: p, days: [5], reminders: false};
    expect(nextSavedPlan(route, time("09:00"))).toMatchObject({date: "2026-10-09", earliestTime: "08:00", latestTime: "10:00"});
    expect(route.plan.date).toBe("2026-10-07");
  });
  it("keeps last night's still-open overnight occurrence", () => {
    const route = {id: "saved", name: "Night", plan: {...p, mode: "leave_between" as const, endDate: "2026-10-08", earliestTime: "23:00", latestTime: "01:00"}, days: [2], reminders: false};
    expect(nextSavedPlan(route, time("00:30"))).toMatchObject({date: "2026-10-06", endDate: "2026-10-07"});
  });
});
