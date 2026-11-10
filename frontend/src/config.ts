/**
 * Frontend configuration — everything comes from env vars.
 * No keys, no secrets. The wallet handles signing.
 */

export const CONTRACT_ID =
  import.meta.env.VITE_CONTRACT_ID ?? "studypact-adebisi.testnet";

export const NETWORK = import.meta.env.VITE_NETWORK ?? "testnet";

export const RPC_URL =
  import.meta.env.VITE_RPC_URL ?? "https://rpc.testnet.near.org";

/** Convert NEAR (human) to yoctoNEAR (chain units). 1 NEAR = 1e24 yocto. */
export function nearToYocto(near: string): string {
  return toSmallestUnit(near, 24);
}

/** Convert a human amount to a token's smallest unit (e.g. 6 for USDC). */
export function toSmallestUnit(amount: string, decimals: number): string {
  const [whole, frac = ""] = amount.split(".");
  const padded = (frac + "0".repeat(decimals)).slice(0, decimals);
  return (
    BigInt(whole || "0") * 10n ** BigInt(decimals) + BigInt(padded || "0")
  ).toString();
}

/** Convert yoctoNEAR back to a human NEAR string. */
export function yoctoToNear(yocto: string, decimals = 4): string {
  const value = BigInt(yocto || "0");
  const sign = value < 0n ? "-" : "";
  const abs = value < 0n ? -value : value;
  const whole = abs / 10n ** 24n;
  const frac = (abs % 10n ** 24n).toString().padStart(24, "0").replace(/0+$/, "");
  if (!frac) return `${sign}${whole.toString()}`;
  return `${sign}${whole}.${frac.slice(0, decimals).padEnd(decimals, "0")}`;
}

/** Shorten an account id: alice.near -> alice.near, verylongname.testnet -> very…testnet */
export function shortId(id: string, head = 10, tail = 6): string {
  if (!id) return "";
  if (id.length <= head + tail + 1) return id;
  return `${id.slice(0, head)}…${id.slice(-tail)}`;
}

/** Format a nanosecond timestamp as a duration string (e.g. "1h 05m"). */
export function formatDuration(ms: number): string {
  if (ms <= 0) return "0m";
  const totalMinutes = Math.floor(ms / 60000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, "0")}m`;
  return `${minutes}m`;
}

/** Nanoseconds -> milliseconds. */
export function nsToMs(ns: string | number): number {
  return Number(ns) / 1_000_000;
}
