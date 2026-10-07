import { useRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { LoaderCircle, X } from "lucide-react";
import { ApiFailure } from "./api";
import { ar, en } from "./i18n";

export function Button({pending, children, disabled, className = "button primary", ...props}: ButtonHTMLAttributes<HTMLButtonElement> & {pending?:boolean}) {
  return <button {...props} className={className} disabled={disabled || pending} aria-busy={pending || undefined}>{pending && <LoaderCircle size={18} className="spin" aria-hidden="true"/>}{children}</button>;
}
export function Notice({kind = "error", children, ...props}:{kind?:"error"|"success"|"warning"; children:ReactNode; id?:string}) {
  return <div {...props} className={`banner ${kind}`} role={kind === "error" ? "alert" : "status"}>{children}</div>;
}
export function Pending({children}:{children:ReactNode}) {return <p className="pending-status" role="status"><LoaderCircle size={18} className="spin" aria-hidden="true"/>{children}</p>;}
export function Empty({children}:{children:ReactNode}) {return <p className="empty-hint">{children}</p>;}
export function FieldError({id, children}:{id:string; children?:ReactNode}) {return children ? <p id={id} className="field-error" role="alert">{children}</p> : null;}
export function Modal({title, description, closeLabel, onClose, children, busy = false}:{title:string;description:string;closeLabel:string;onClose:()=>void;children:ReactNode;busy?:boolean}) {
  const returnFocus = useRef(document.activeElement);
  return <Dialog.Root open onOpenChange={open => {if(!open)onClose();}}><Dialog.Portal><Dialog.Overlay className="dialog-overlay"/><Dialog.Content className="dialog-content" aria-busy={busy} onCloseAutoFocus={event => {event.preventDefault(); const target=returnFocus.current; if(target instanceof HTMLElement && target.isConnected) target.focus();}}><Dialog.Title>{title}</Dialog.Title><Dialog.Description>{description}</Dialog.Description><Dialog.Close className="dialog-close" aria-label={closeLabel}><X size={20}/></Dialog.Close>{children}</Dialog.Content></Dialog.Portal></Dialog.Root>;
}
export function displayFailure(error: unknown, locale: "en" | "ar") {
  const t = locale === "ar" ? ar : en;
  if (error instanceof ApiFailure) {
    if (error.status === 401) return t.accountRequired;
    if (error.status === 403) return error.code === "VERIFICATION_REQUIRED" || /verif|human/i.test(error.message) ? t.verificationFailed : t.permissionDenied;
    if (error.status === 429) return error.code === "DAILY_ALLOWANCE" ? t.dailyAllowance : t.usageLimit;
    if (error.status >= 500) return t.providerFailure;
    if (error.status === 400) return t.invalidInput;
  }
  if (error instanceof TypeError) return t.networkFailure;
  return t.error;
}
