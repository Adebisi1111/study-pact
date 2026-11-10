import { NearConnector } from "@hot-labs/near-connect";
import { JsonRpcProvider } from "near-api-js";
import { CONTRACT_ID, NETWORK, RPC_URL } from "./config";

/** Wallet connector — handles sign-in and transactions. */
export const connector = new NearConnector({
  network: NETWORK as "testnet" | "mainnet",
});

/** Read-only provider for view calls. */
export const provider = new JsonRpcProvider({ url: RPC_URL });

/** Call a read-only (view) method on the contract. */
export async function view<T extends object = object>(
  method: string,
  args: Record<string, unknown> = {}
): Promise<T | undefined> {
  return provider.callFunction<T>({
    contractId: CONTRACT_ID,
    method,
    args,
  });
}

/** Call a change method. depositYocto defaults to "0". */
export async function call(
  method: string,
  args: Record<string, unknown>,
  depositYocto = "0"
) {
  const wallet = await connector.wallet();
  return wallet.signAndSendTransaction({
    receiverId: CONTRACT_ID,
    actions: [
      {
        type: "FunctionCall",
        params: {
          methodName: method,
          args,
          gas: "100000000000000", // 100 TGas
          deposit: depositYocto,
        },
      },
    ],
  });
}

/** The signed-in account id, or "" if not connected. */
export async function getAccountId(): Promise<string> {
  try {
    const wallet = await connector.wallet();
    const accounts = await wallet.getAccounts();
    return accounts[0]?.accountId ?? "";
  } catch {
    return "";
  }
}

/** sha256 of a string, as lowercase hex. Used for the check-in code hash. */
export async function sha256Hex(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// ---------------------------------------------------------------------------
// 1Click (NEAR Intents) — quote preview only
// ---------------------------------------------------------------------------

const ONECLICK_API = "https://1click.chaindefuser.com/v0";
const WNEAR_ASSET = "nep141:wrap.near";
const WRAP_NEAR_CONTRACT = "wrap.near";

export type Token = {
  assetId: string;
  symbol: string;
  blockchain: string;
  decimals: number;
};

/** Fetch the list of supported tokens from 1Click. */
export async function getTokens(): Promise<Token[]> {
  const res = await fetch(`${ONECLICK_API}/tokens`);
  return res.json();
}

export type QuoteParams = {
  originAsset: string;
  amount: string;
  recipient: string;
  refundTo: string;
  dry?: boolean;
  slippageTolerance?: number;
};

export type Quote = {
  amountIn: string;
  amountInFormatted: string;
  amountOut: string;
  amountOutFormatted: string;
  minAmountOut: string;
  timeEstimate: number;
  depositAddress?: string;
};

/**
 * Request a 1Click quote.
 *
 * NOTE: `dry: true` only validates and prices — it returns NO depositAddress
 * and executes nothing. The UI uses this for the testnet quote preview.
 */
export async function requestQuote(params: QuoteParams): Promise<Quote> {
  const deadline = new Date(Date.now() + 5 * 60 * 1000).toISOString();
  const res = await fetch(`${ONECLICK_API}/quote`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      dry: params.dry ?? true,
      swapType: "EXACT_INPUT",
      slippageTolerance: params.slippageTolerance ?? 100,
      originAsset: params.originAsset,
      depositType: "ORIGIN_CHAIN",
      destinationAsset: WNEAR_ASSET,
      amount: params.amount,
      recipient: params.recipient,
      recipientType: "INTENTS", // delivers to the recipient's NEAR account
      refundTo: params.refundTo,
      refundType: "ORIGIN_CHAIN", // refund must be on the ORIGIN chain
      deadline,
    }),
  });
  const data = await res.json();
  if (!res.ok || !data.quote) {
    throw new Error(data.message ?? "Quote failed");
  }
  return data.quote;
}

/**
 * Unwrap wNEAR into native NEAR via wrap.near's `near_withdraw`.
 * Requires exactly 1 yoctoNEAR attached.
 */
export async function unwrapWnear(amountYocto: string) {
  const wallet = await connector.wallet();
  return wallet.signAndSendTransaction({
    receiverId: WRAP_NEAR_CONTRACT,
    actions: [
      {
        type: "FunctionCall",
        params: {
          methodName: "near_withdraw",
          args: { amount: amountYocto },
          gas: "100000000000000", // 100 TGas
          deposit: "1", // exactly 1 yoctoNEAR
        },
      },
    ],
  });
}

