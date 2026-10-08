import {useEffect,useRef,useState} from "react";
import {supabase} from "./api";
import {accountAr,accountEn} from "./account-copy";
import {accountFailure} from "./account-auth";
import {ar,en} from "./i18n";
import {Button,FieldError,Modal} from "./feedback";
export default function PasswordDialog({userId,email,locale,onClose,onSaved}: {userId:string;email:string;locale:"en"|"ar";onClose:()=>void;onSaved:()=>void}) {
  const a=locale==="ar"?accountAr:accountEn,t=locale==="ar"?ar:en;
  const [password,setPassword]=useState(""),[confirm,setConfirm]=useState(""),[shown,setShown]=useState(false),[error,setError]=useState(""),[busy,setBusy]=useState(false);
  const pending=useRef(false),active=useRef(false);
  useEffect(()=>{active.current=true;return()=>{active.current=false;};},[]);
  async function save() {
    if(pending.current||!supabase)return;
    if(password.length<12){setError(a.weak);return;}
    if(password!==confirm){setError(a.mismatch);return;}
    pending.current=true;setBusy(true);setError("");
    try {
      const {data,error:sessionError}=await supabase.auth.getSession();
      if(!active.current)return;
      if(sessionError||data.session?.user.id!==userId)throw new Error("account-changed");
      const result=await supabase.auth.updateUser({password});
      if(result.error)throw result.error;
      if(result.data.user?.id!==userId)throw new Error("account-changed");
      if(active.current){setPassword("");setConfirm("");onSaved();}
    }catch(e){if(active.current)setError(e instanceof Error&&e.message==="account-changed"?a.changedAccount:accountFailure(e,locale,a.recentLogin));}
    finally{pending.current=false;if(active.current)setBusy(false);}
  }
  return <Modal title={a.resetTitle} description={a.resetHelp} closeLabel={t.close} busy={busy} onClose={onClose}>
    <p><bdi>{email}</bdi></p><FieldError id="password-error">{error}</FieldError>
    <form className="account-form" onSubmit={e=>{e.preventDefault();void save();}}>
      <label>{a.password}<input type={shown?"text":"password"} autoComplete="new-password" required minLength={12} maxLength={128} value={password} disabled={busy} onChange={e=>setPassword(e.target.value)} aria-describedby="password-help"/></label>
      <p className="micro-copy" id="password-help">{a.passwordHelp}</p>
      <label>{a.confirm}<input type={shown?"text":"password"} autoComplete="new-password" required maxLength={128} value={confirm} disabled={busy} onChange={e=>setConfirm(e.target.value)}/></label>
      <Button type="button" className="button text-button account-link" disabled={busy} aria-pressed={shown} onClick={()=>setShown(v=>!v)}>{shown?a.hide:a.show}</Button>
      <Button type="submit" className="button primary full" pending={busy}>{a.save}</Button>
    </form>
  </Modal>;
}
