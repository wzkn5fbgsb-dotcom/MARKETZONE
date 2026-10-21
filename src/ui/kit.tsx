// Componentes base del sistema de diseño MARKETZONE.
import { Children, cloneElement, isValidElement, type ReactElement, createContext, useCallback, useContext, useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes,
  type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { Icon, type IconName } from "./icons";
import { useImageSrc } from "../app/images";
import { remaining, tone } from "../app/format";
import type { ApiError } from "../api/backend";

type BtnVariant = "primary" | "dark" | "outline" | "ghost" | "danger" | "white";
export function Button({ variant = "dark", size, block, loading, icon, children, className = "", ...rest }:
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant; size?: "sm" | "lg"; block?: boolean; loading?: boolean; icon?: IconName }) {
  return (
    <button className={`btn btn-${variant} ${size ? `btn-${size}` : ""} ${block ? "btn-block" : ""} ${className}`} disabled={loading || rest.disabled} {...rest}>
      {loading ? <span className="spin" aria-hidden /> : icon ? <Icon name={icon} size={18} /> : null}
      {children}
    </button>
  );
}

export function Spinner({ label = "Cargando" }: { label?: string }) {
  return <div className="loading-block" role="status" aria-live="polite"><div className="spin" /><span className="sr-only" hidden>{label}</span></div>;
}

export function Skeleton({ h = 16, w = "100%", r }: { h?: number | string; w?: number | string; r?: number }) {
  return <div className="skel" style={{ height: h, width: w, borderRadius: r }} />;
}

export function Badge({ children, kind, title }: { children: ReactNode; kind?: "ok" | "warn" | "bad" | "info" | "accent" | "outline" | "demo" | "muted"; title?: string }) {
  return <span className={`badge ${kind ?? ""}`} title={title}>{children}</span>;
}

export function StatusBadge({ status, label }: { status: string; label: string }) {
  return <Badge kind={tone(status) as "ok"}>{label}</Badge>;
}

export function Field({ label, hint, error, required, children, className = "" }:
  { label?: ReactNode; hint?: ReactNode; error?: string | null; required?: boolean; children: ReactNode; className?: string }) {
  // Vincula la etiqueta con el control (accesibilidad y toque en la etiqueta en iOS) cuando hay un único campo.
  const autoId = useId();
  const only = Children.count(children) === 1 && isValidElement(children) && (children.type === Input || children.type === Select || children.type === TextArea)
    ? (children as ReactElement<{ id?: string; "aria-required"?: boolean }>) : null;
  const controlId = only ? (only.props.id ?? `f${autoId.replace(/:/g, "")}`) : undefined;
  const control = only ? cloneElement(only, { id: controlId, "aria-required": required || undefined }) : children;
  return (
    <div className={`field ${error ? "has-error" : ""} ${className}`}>
      {label && (controlId
        ? <label className="label" htmlFor={controlId}>{label}{required && <span className="req" aria-hidden="true">*</span>}</label>
        : <span className="label">{label}{required && <span className="req">*</span>}</span>)}
      {control}
      {error ? <span className="error-text" role="alert">{error}</span> : hint ? <span className="hint">{hint}</span> : null}
    </div>
  );
}

export function Input(props: InputHTMLAttributes<HTMLInputElement>) { return <input className="input" {...props} />; }
export function TextArea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) { return <textarea className="textarea" {...props} />; }
export function Select({ children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) { return <select className="select" {...props}>{children}</select>; }

export function MoneyInput({ cents, onChange, id, placeholder = "0.00" }: { cents: number | null; onChange: (c: number | null) => void; id?: string; placeholder?: string }) {
  const [text, setText] = useState(cents !== null ? (cents / 100).toFixed(2) : "");
  const last = useRef(cents);
  useEffect(() => {
    if (cents !== last.current) { setText(cents !== null ? (cents / 100).toFixed(2) : ""); last.current = cents; }
  }, [cents]);
  return (
    <div className="input-group">
      <span className="addon">$</span>
      <input id={id} className="input num" inputMode="decimal" placeholder={placeholder} value={text}
        onChange={(e) => {
          const v = e.target.value.replace(/[^0-9.]/g, "");
          setText(v);
          const n = v ? Math.round(Number(v) * 100) : null;
          last.current = Number.isFinite(n as number) ? n : null;
          onChange(last.current);
        }} />
    </div>
  );
}

export function Toggle({ checked, onChange, label, id }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; id?: string }) {
  return <label className="toggle"><input id={id} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} /> <span>{label}</span></label>;
}

export function Empty({ icon = "box", title, children, action }: { icon?: IconName; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <Icon name={icon} size={30} stroke={1.5} />
      <div className="h3">{title}</div>
      {children && <div className="small" style={{ maxWidth: 420 }}>{children}</div>}
      {action}
    </div>
  );
}

export function Callout({ kind, icon, children }: { kind?: "warn" | "bad" | "ok" | "info"; icon?: IconName; children: ReactNode }) {
  const ic: IconName = icon ?? (kind === "bad" || kind === "warn" ? "alert" : kind === "ok" ? "check" : "info");
  return <div className={`callout ${kind ?? ""}`}><Icon name={ic} size={18} /><div>{children}</div></div>;
}

export function ErrorBox({ error, onRetry }: { error: ApiError | null; onRetry?: () => void }) {
  if (!error) return null;
  return (
    <Callout kind="bad">
      <div className="stack" style={{ gap: 8 }}>
        <span>{error.message}</span>
        {onRetry && <div><Button size="sm" variant="outline" onClick={onRetry} icon="refresh">Reintentar</Button></div>}
      </div>
    </Callout>
  );
}

export function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return <div className="stat"><div className="eyebrow">{label}</div><div className="v">{value}</div>{sub && <div className="s">{sub}</div>}</div>;
}

export function Tabs<T extends string>({ value, onChange, items }: { value: T; onChange: (v: T) => void; items: { id: T; label: string; count?: number }[] }) {
  return (
    <div className="tabs" role="tablist">
      {items.map((t) => (
        <button key={t.id} role="tab" aria-selected={value === t.id} className={`tab ${value === t.id ? "on" : ""}`} onClick={() => onChange(t.id)}>
          {t.label}{t.count !== undefined && <span className="count">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function Sheet({ open, onClose, title, children, footer }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="sheet" role="dialog" aria-modal="true">
        <div className="sheet-h"><div className="h3">{title}</div><button className="icon-btn" onClick={onClose} aria-label="Cerrar"><Icon name="close" /></button></div>
        <div className="stack">{children}</div>
        {footer && <div className="row" style={{ marginTop: 18, justifyContent: "flex-end" }}>{footer}</div>}
      </div>
    </div>
  );
}

/** Botón con confirmación integrada (los diálogos nativos no están disponibles en todos los visores). */
export function ConfirmButton({ children, confirmLabel = "Confirmar", onConfirm, variant = "outline", size = "sm", icon, loading }:
  { children: ReactNode; confirmLabel?: string; onConfirm: () => void; variant?: BtnVariant; size?: "sm" | "lg"; icon?: IconName; loading?: boolean }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => { if (!armed) return; const t = setTimeout(() => setArmed(false), 4000); return () => clearTimeout(t); }, [armed]);
  if (armed) return (
    <span className="row" style={{ gap: 6 }}>
      <Button size={size} variant="danger" loading={loading} onClick={() => { setArmed(false); onConfirm(); }}>{confirmLabel}</Button>
      <Button size={size} variant="ghost" onClick={() => setArmed(false)}>No</Button>
    </span>
  );
  return <Button size={size} variant={variant} icon={icon} loading={loading} onClick={() => setArmed(true)}>{children}</Button>;
}

export function Img({ src, alt, className, loading = "lazy" }: { src: string | null | undefined; alt: string; className?: string; loading?: "lazy" | "eager" }) {
  const resolved = useImageSrc(src);
  if (!resolved) return <div className={className} style={{ width: "100%", height: "100%", background: "var(--surface)" }} aria-label={alt} />;
  return <img src={resolved} alt={alt} className={className} loading={loading} decoding="async" draggable={false} />;
}

export function Avatar({ name, src, size }: { name: string; src?: string | null; size?: "lg" }) {
  const resolved = useImageSrc(src ?? null);
  return <div className={`avatar ${size ?? ""}`}>{resolved ? <img src={resolved} alt="" /> : (name || "?").slice(0, 1).toUpperCase()}</div>;
}

export function Countdown({ to, prefix = "Vence en" }: { to: string; prefix?: string }) {
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick((x) => x + 1), 30000); return () => clearInterval(t); }, []);
  const r = remaining(to);
  return <span className="countdown">{r === "vencido" ? "Plazo vencido" : `${prefix} ${r}`}</span>;
}

export function Stars({ value, size = 14 }: { value: number; size?: number }) {
  return (
    <span className="row" style={{ gap: 2 }} aria-label={`${value} de 5`}>
      {[1, 2, 3, 4, 5].map((i) => <Icon key={i} name="star" size={size} fill={i <= Math.round(value) ? "currentColor" : undefined} style={{ color: i <= Math.round(value) ? "#F2B544" : "var(--line)" }} />)}
    </span>
  );
}

// ------------------------------------------------------------------ Toasts
interface ToastItem { id: number; text: string; kind?: "ok" | "bad" }
const ToastCtx = createContext<(text: string, kind?: "ok" | "bad") => void>(() => {});
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const push = useCallback((text: string, kind?: "ok" | "bad") => {
    const id = Date.now() + Math.random();
    setItems((x) => [...x.slice(-2), { id, text, kind }]);
    setTimeout(() => setItems((x) => x.filter((t) => t.id !== id)), 4200);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" aria-live="polite">
        {items.map((t) => <div key={t.id} className={`toast ${t.kind ?? ""}`}><Icon name={t.kind === "bad" ? "alert" : "check"} size={18} />{t.text}</div>)}
      </div>
    </ToastCtx.Provider>
  );
}
export function useToast() { return useContext(ToastCtx); }

export function useFieldId() { return useId(); }
