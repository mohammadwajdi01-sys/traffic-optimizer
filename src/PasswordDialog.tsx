import {useEffect,useRef,useState} from "react";
import {supabase} from "./api";
import {accountAr,accountEn} from "./account-copy";
import {accountFailure} from "./account-auth";
import {PasswordField,PasswordRequirements} from "./PasswordField";
import {validNewPassword} from "./password-policy";
import {ar,en} from "./i18n";
import {Button,FieldError,Modal} from "./feedback";
export default function PasswordDialog({userId,email,locale,onClose,onSaved}: {userId:string;email:string;locale:"en"|"ar";onClose:()=>void;onSaved:()=>void}) {
  const a=locale==="ar"?accountAr:accountEn,t=locale==="ar"?ar:en;
  const [password,setPassword]=useState(""),[confirm,setConfirm]=useState(""),[error,setError]=useState(""),[busy,setBusy]=useState(false);
  const pending=useRef(false),active=useRef(false);
  useEffect(()=>{active.current=true;return()=>{active.current=false;};},[]);
  async function save() {
    if(pending.current||!supabase)return;
    if(!validNewPassword(password)){setError(a.weak);return;}
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
      <PasswordField label={a.password} locale={locale} autoComplete="new-password" required minLength={8} maxLength={128} value={password} disabled={busy} onChange={e=>setPassword(e.target.value)} aria-describedby="password-help"/>
      <PasswordRequirements password={password} locale={locale} id="password-help"/>
      <PasswordField label={a.confirm} locale={locale} autoComplete="new-password" required maxLength={128} value={confirm} disabled={busy} onChange={e=>setConfirm(e.target.value)}/>
      <Button type="submit" className="button primary full" pending={busy}>{a.save}</Button>
    </form>
  </Modal>;
}
