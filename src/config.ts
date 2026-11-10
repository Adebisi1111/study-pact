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
  const [whole, frac = ""] = near.split(".");
  const padded = (frac + "0".repeat(24)).slice(0, 24);
  return (BigInt(whole) * 10n ** 24n + BigInt(padded || "0")).toString();
}
