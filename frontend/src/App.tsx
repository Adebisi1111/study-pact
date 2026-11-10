import { useEffect, useState } from "react";
import { connector, getAccountId } from "./near";
import { shortId } from "./config";
import { ToastContainer, useToasts, friendlyError, Spinner } from "./ui";
import { BookIcon, WalletIcon } from "./icons";
import Home from "./Home";
import Create from "./Create";
import Session from "./Session";
import "./styles.css";

/* --------------------------------------------------------------------------
   Hash router
   -------------------------------------------------------------------------- */

function useHashRoute() {
  const [hash, setHash] = useState(() => window.location.hash);
  useEffect(() => {
    const onChange = () => setHash(window.location.hash);
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return hash;
}

export function navigate(to: string) {
  window.location.hash = to;
}

/* --------------------------------------------------------------------------
   Wallet
   -------------------------------------------------------------------------- */

type PushFn = (msg: string, type?: "success" | "error" | "info") => void;

function useWallet(push: PushFn) {
  const [accountId, setAccountId] = useState("");
  const [connecting, setConnecting] = useState(false);

  useEffect(() => {
    getAccountId().then(setAccountId).catch(() => {});
  }, []);

  const connect = async () => {
    setConnecting(true);
    try {
      const wallet = await connector.connect();
      const accounts = await wallet.getAccounts();
      const id = accounts[0]?.accountId ?? "";
      setAccountId(id);
      if (id) push(`Connected ${shortId(id)}`, "success");
    } catch (e) {
      push(friendlyError(e), "error");
    } finally {
      setConnecting(false);
    }
  };

  const disconnect = async () => {
    try {
      const wallet = await connector.wallet();
      await connector.disconnect(wallet);
    } catch {
      /* ignore */
    }
    setAccountId("");
  };

  return { accountId, connecting, connect, disconnect };
}

/* --------------------------------------------------------------------------
   App
   -------------------------------------------------------------------------- */

export default function App() {
  const route = useHashRoute();
  const { toasts, push, dismiss } = useToasts();
  const { accountId, connecting, connect, disconnect } = useWallet(push);

  const sessionMatch = route.match(/^#\/session\/(\d+)/);

  return (
    <div className="app">
      <header className="header">
        <div className="header-inner">
          <button
            className="brand"
            onClick={() => navigate("#/")}
            aria-label="Study Pact home"
          >
            <span className="brand-mark">
              <BookIcon size={15} />
            </span>
            <span className="brand-name">Study Pact</span>
          </button>
          <div className="header-actions">
            {accountId ? (
              <button className="btn btn-ghost btn-sm" onClick={disconnect}>
                <WalletIcon size={14} />
                <span className="mono">{shortId(accountId, 8, 6)}</span>
              </button>
            ) : (
              <button
                className="btn btn-primary btn-sm"
                onClick={connect}
                disabled={connecting}
              >
                {connecting ? <Spinner size={14} /> : <WalletIcon size={14} />}
                {connecting ? "Connecting…" : "Connect"}
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="fade-in" key={route}>
        {sessionMatch ? (
          <Session
            id={Number(sessionMatch[1])}
            accountId={accountId}
            push={push}
            connect={connect}
            connecting={connecting}
          />
        ) : route.startsWith("#/create") ? (
          <Create
            accountId={accountId}
            push={push}
            connect={connect}
            connecting={connecting}
          />
        ) : (
          <Home />
        )}
      </main>

      <ToastContainer toasts={toasts} onDismiss={dismiss} />
    </div>
  );
}
