import { useCallback, useState } from "react";
import { CheckIcon, SpinnerIcon } from "./icons";

/* --------------------------------------------------------------------------
   Toasts
   -------------------------------------------------------------------------- */

export type ToastType = "success" | "error" | "info";
export type Toast = { id: number; message: string; type: ToastType };

export function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const push = useCallback((message: string, type: ToastType = "info") => {
    const id = Date.now() + Math.random();
    setToasts((current) => [...current, { id, message, type }]);
    window.setTimeout(() => {
      setToasts((current) => current.filter((t) => t.id !== id));
    }, 4200);
  }, []);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((t) => t.id !== id));
  }, []);

  return { toasts, push, dismiss };
}

export function ToastContainer({
  toasts,
  onDismiss,
}: {
  toasts: Toast[];
  onDismiss: (id: number) => void;
}) {
  if (toasts.length === 0) return null;
  return (
    <div className="toast-wrap" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`toast toast-${t.type}`}
          onClick={() => onDismiss(t.id)}
        >
          {t.message}
        </div>
      ))}
    </div>
  );
}

/* --------------------------------------------------------------------------
   Primitives
   -------------------------------------------------------------------------- */

export function Skeleton({ height = 20, width = "100%" }: { height?: number; width?: number | string }) {
  return (
    <div
      className="skeleton"
      style={{ height, width }}
      aria-hidden="true"
    />
  );
}

export function Chip({ children, tone = "neutral" }: { children: React.ReactNode; tone?: "open" | "live" | "ended" | "settled" | "joined" | "checked" | "noshow" | "neutral" }) {
  return <span className={`chip chip-${tone}`}>{children}</span>;
}

export function Avatar({ name }: { name: string }) {
  const initials = name
    .replace(/\.near$/, "")
    .split(/[._-]/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0] ?? "")
    .join("");
  return (
    <div className="avatar" aria-hidden="true">
      {initials || "?"}
    </div>
  );
}

export function Spinner({ size = 18 }: { size?: number }) {
  return <SpinnerIcon size={size} aria-hidden="true" />;
}

export function TxLink({ hash }: { hash: string }) {
  if (!hash) return null;
  const short = `${hash.slice(0, 8)}…${hash.slice(-4)}`;
  return (
    <a
      className="tx-link"
      href={`https://testnet.nearblocks.io/txns/${hash}`}
      target="_blank"
      rel="noreferrer noopener"
    >
      {short} ↗
    </a>
  );
}

export function Stepper({
  steps,
  current,
}: {
  steps: { title: string; desc: string }[];
  current: number;
}) {
  return (
    <div className="stepper">
      {steps.map((step, index) => {
        const state = index < current ? "done" : index === current ? "active" : "";
        return (
          <div key={step.title} className={`stepper-item ${state}`}>
            <div className="stepper-dot">
              {index < current ? <CheckIcon size={13} /> : index + 1}
            </div>
            <div className="stepper-content">
              <div className="stepper-title">{step.title}</div>
              <div className="stepper-desc">{step.desc}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Friendly error: pull the message out of an Error or a JSON blob. */
export function friendlyError(error: unknown): string {
  if (!error) return "Something went wrong.";
  if (typeof error === "string") return cleanError(error);
  if (error instanceof Error) {
    // NEAR errors often look like "Error: xxx" or contain a JSON payload.
    return cleanError(error.message ?? "");
  }
  if (typeof error === "object" && "message" in error) {
    return cleanError(String((error as { message: unknown }).message));
  }
  return "Something went wrong.";
}

/** Extract a human-readable message from a NEAR RPC error blob. */
function cleanError(msg: string): string {
  const text = msg ?? "";
  // Contract panic: HostError(GuestPanic { panic_msg: "..." })
  const panic = text.match(/panic_msg:\s*"((?:[^"\\]|\\.)*)"/);
  if (panic) return panic[1].replace(/\\n/g, " ").replace(/\\"/g, '"');
  // JSON payload: {"message":"..."}
  const json = text.match(/"message"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  if (json) return json[1].replace(/\\n/g, " ");
  return text.replace(/^Error:\s*/, "").slice(0, 180);
}

/** True when the contract says the session does not exist. */
export function isNotFoundError(error: unknown): boolean {
  const msg = friendlyError(error).toLowerCase();
  return msg.includes("session not found") || msg.includes("not found");
}
