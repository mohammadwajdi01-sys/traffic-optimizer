import type { SavedRoute } from "../shared/types";
import { ar, en } from "./i18n";
import { Button, Empty } from "./feedback";

export function SavedRouteSelector({routes, value, loading, failed, busy, signedIn, authConfigured, locale, onSelect, onSignIn, onRetry}: {
  routes: SavedRoute[]; value:string; loading:boolean; failed:boolean; busy:boolean; signedIn:boolean; authConfigured:boolean; locale:"en"|"ar";
  onSelect:(route:SavedRoute)=>void; onSignIn:()=>void; onRetry:()=>void;
}) {
  const t=locale==="ar"?ar:en;
  return <section className="quick-routes" aria-label={t.quickRoutes}>
    <label>{t.quickRoutes}<select value={value} disabled={busy || loading || !routes.length} onChange={event=>{const route=routes.find(r=>r.id===event.target.value);if(route)onSelect(route);}}>
      <option value="">{loading?t.loadingRoutes:t.chooseRoute}</option>
      {routes.map(route=><option key={route.id} value={route.id}>{route.name} · {route.plan.destination.displayName}</option>)}
    </select></label>
    <Empty>{!signedIn && !routes.length ? t.savedSignInHelp : !loading && !failed && !routes.length ? t.savedEmptyHelp : t.quickRoutesHelp}</Empty>
    {!signedIn && !routes.length && authConfigured && <Button type="button" className="button secondary" onClick={onSignIn}>{t.signin}</Button>}
    {failed && <Button type="button" className="button secondary" onClick={onRetry}>{t.retryRoutes}</Button>}
  </section>;
}
