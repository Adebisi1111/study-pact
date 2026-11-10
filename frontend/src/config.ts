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
