import { useEffect, useRef, useState } from "react";
import type { AppConfig } from "../shared/types";
import { supabase } from "./api";
import { en, ar } from "./i18n";
import { accountEn, accountAr } from "./account-copy";
import { accountFailure, accountRedirect } from "./account-auth";
import {PasswordField,PasswordRequirements} from "./PasswordField";
import {validNewPassword} from "./password-policy";
import { useStore } from "./store";
import {Button, FieldError, Modal, Notice, Pending} from "./feedback";
export type AccountMode = "login" | "signup" | "forgot" | "link" | "confirm";
export default function SignInDialog({config,email,onEmail,onClose,initialMode="login",linkError=false,focusTarget}: {
  config:AppConfig; email:string; onEmail:(email:string)=>void; onClose:()=>void; initialMode?:AccountMode; linkError?:boolean; focusTarget?:()=>HTMLElement|null;
}) {
  const locale=useStore(s=>s.locale), t=locale==="ar"?ar:en, a=locale==="ar"?accountAr:accountEn;
  const [mode,setMode]=useState<AccountMode>(initialMode), [password,setPassword]=useState(""), [confirm,setConfirm]=useState("");
  const [error,setError]=useState(linkError?a.expired:""),[busy,setBusy]=useState(false),[sent,setSent]=useState("");
  const pending=useRef(false),active=useRef(false);
  useEffect(()=>{active.current=true;return()=>{active.current=false;};},[]);
  function change(next:AccountMode) {if(pending.current)return;setMode(next);setError("");setSent("");setPassword("");setConfirm("");}
  async function submit(method:AccountMode|"google"=mode) {
    if(pending.current)return;
    if(!supabase){setError(t.authFailed);return;}
    if(method==="signup" && !validNewPassword(password)){setError(a.weak);return;}
    if(method==="signup" && password!==confirm){setError(a.mismatch);return;}
    pending.current=true;setBusy(true);setError("");setSent("");
    try {
      const address=email.trim(), redirect=accountRedirect();
      const result=method==="google"?await supabase.auth.signInWithOAuth({provider:"google",options:{redirectTo:redirect}})
        :method==="login"?await supabase.auth.signInWithPassword({email:address,password})
        :method==="signup"?await supabase.auth.signUp({email:address,password,options:{emailRedirectTo:redirect}})
        :method==="forgot"?await supabase.auth.resetPasswordForEmail(address,{redirectTo:redirect})
        :method==="confirm"?await supabase.auth.resend({type:"signup",email:address,options:{emailRedirectTo:redirect}})
        :await supabase.auth.signInWithOtp({email:address,options:{emailRedirectTo:redirect,shouldCreateUser:config.publicBeta}});
      if(result.error)throw result.error;
      if(!active.current)return;
      setPassword("");setConfirm("");
      if(method==="login"){onClose();return;}
      if(method==="signup") {
        if("data" in result && result.data && "session" in result.data && result.data.session){onClose();return;}
        setMode("confirm");setSent(a.confirmation);
      } else if(method==="confirm")setSent(a.confirmation);
      else if(method==="forgot")setSent(a.resetRequested);
      else if(method==="link")setSent(t.signinLinkRequested);
    } catch(e) {
      if(active.current) {
        const rate=typeof e==="object" && e && "status" in e && e.status===429;
        setError(rate?t.usageLimit:accountFailure(e,locale,method==="login"?a.invalidLogin:method==="google"?t.authFailed:a.unavailable));
      }
    } finally {pending.current=false;if(active.current)setBusy(false);}
  }
  const title=mode==="signup"?a.signup:mode==="forgot"?a.reset:mode==="confirm"?a.resend:t.signin;
  const action=mode==="login"?a.login:mode==="signup"?a.signup:mode==="forgot"?a.reset:mode==="confirm"?a.resend:t.sendLink;
  return <Modal title={title} description={config.authConfigured?a.help:t.authSetup} closeLabel={t.close} onClose={onClose} busy={busy} focusTarget={focusTarget}>
    <FieldError id="signin-error">{error}</FieldError>{busy&&<Pending>{t.signingIn}</Pending>}{sent&&<Notice kind="success">{sent}</Notice>}
    {config.authConfigured&&config.googleAuthEnabled&&<Button className="button primary full" type="button" disabled={busy} onClick={()=>void submit("google")}>{t.signinGoogle}</Button>}
    {config.authConfigured&&<>
      <form className="account-form" onSubmit={e=>{e.preventDefault();void submit();}}>
        <label>{t.email}<input type="email" autoComplete="email" autoCapitalize="none" spellCheck={false} required disabled={busy} aria-invalid={Boolean(error)} aria-describedby={error?"signin-error":undefined} value={email} onChange={e=>onEmail(e.target.value)}/></label>
        {(mode==="login"||mode==="signup")&&<>
          <PasswordField key={mode} label={a.password} locale={locale} autoComplete={mode==="signup"?"new-password":"current-password"} minLength={mode==="signup"?8:undefined} maxLength={128} required disabled={busy} value={password} onChange={e=>setPassword(e.target.value)} aria-describedby={mode==="signup"?"password-help":undefined}/>
          {mode==="signup"&&<><PasswordRequirements password={password} locale={locale} id="password-help"/><PasswordField label={a.confirm} locale={locale} autoComplete="new-password" required disabled={busy} maxLength={128} value={confirm} onChange={e=>setConfirm(e.target.value)}/></>}

        </>}
        <Button className="button primary full" type="submit" disabled={busy}>{action}</Button>
      </form>
      <div className="account-methods">
        {mode==="login"?<><Button type="button" className="button secondary" disabled={busy} onClick={()=>change("signup")}>{a.signup}</Button><Button type="button" className="button text-button account-link" disabled={busy} onClick={()=>change("forgot")}>{a.forgot}</Button><Button type="button" className="button text-button account-link" disabled={busy} onClick={()=>change("confirm")}>{a.resend}</Button><Button type="button" className="button text-button account-link" disabled={busy} onClick={()=>change("link")}>{a.link}</Button></>:<Button type="button" className="button secondary" disabled={busy} onClick={()=>change("login")}>{a.back}</Button>}
        {linkError&&mode!=="confirm"&&mode!=="login"&&<Button type="button" className="button text-button account-link" disabled={busy} onClick={()=>change("confirm")}>{a.resend}</Button>}
      </div>
    </>}
  </Modal>;
}
