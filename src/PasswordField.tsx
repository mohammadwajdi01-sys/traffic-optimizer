import {useId,useState,type InputHTMLAttributes} from "react";
import {Eye,EyeOff} from "lucide-react";
import {accountAr,accountEn} from "./account-copy";
import {passwordChecks} from "./password-policy";
export function PasswordField({label,locale,...props}:Omit<InputHTMLAttributes<HTMLInputElement>,"type">&{label:string;locale:"en"|"ar"}) {
  const id=useId(),[shown,setShown]=useState(false),a=locale==="ar"?accountAr:accountEn;
  return <div className="password-field"><label htmlFor={id}>{label}</label><div className="password-input"><input {...props} id={id} type={shown?"text":"password"} autoCapitalize="none" spellCheck={false}/><button className="password-eye" type="button" disabled={props.disabled} aria-label={`${shown?a.hide:a.show}: ${label}`} aria-controls={id} aria-pressed={shown} onClick={()=>setShown(v=>!v)}>{shown?<EyeOff size={20} aria-hidden="true"/>:<Eye size={20} aria-hidden="true"/>}</button></div></div>;
}
export function PasswordRequirements({password,locale,id}:{password:string;locale:"en"|"ar";id:string}) {
  const a=locale==="ar"?accountAr:accountEn,checks=passwordChecks(password);
  const labels=[a.lengthRule,a.upperRule,a.lowerRule,a.numberRule,a.symbolRule];
  return <div id={id} className="password-requirements"><p>{a.passwordHelp}</p><ul>{labels.map((label,i)=><li key={label} className={checks[i]?"met":""}><span aria-hidden="true">{checks[i]?"✓":"○"}</span><span>{label}<span className="sr-only"> — {checks[i]?a.ruleMet:a.ruleMissing}</span></span></li>)}</ul></div>;
}
