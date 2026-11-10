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
