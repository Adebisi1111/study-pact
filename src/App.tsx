import { useEffect, useState } from "react";
import {
  connector,
  view,
  call,
  sha256Hex,
  getTokens,
  requestQuote,
  unwrapWnear,
} from "./near";
import type { Token, Quote } from "./near";
import { nearToYocto, toSmallestUnit } from "./config";
import "./App.css";

type Session = {
  id: number;
  title: string;
  host: string;
  deposit: string;
  start_time: string;
  end_time: string;
  code_hash: string;
  settled: boolean;
};

type Participant = { account: string; checked_in: boolean };

export default function App() {
  const [accountId, setAccountId] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  // create
  const [title, setTitle] = useState("");
  const [deposit, setDeposit] = useState("1");
  const [durationMin, setDurationMin] = useState("60");
  const [code, setCode] = useState("");
  // join
  const [joinId, setJoinId] = useState("");
  // check-in
  const [checkinId, setCheckinId] = useState("");
  const [checkinCode, setCheckinCode] = useState("");
  // settle
  const [settleId, setSettleId] = useState("");
  // view
  const [viewId, setViewId] = useState("");
  const [session, setSession] = useState<Session | null>(null);
  const [participants, setParticipants] = useState<Participant[]>([]);

  // quote preview (1Click / NEAR Intents)
  const [tokens, setTokens] = useState<Token[]>([]);
  const [originAsset, setOriginAsset] = useState("");
  const [swapAmount, setSwapAmount] = useState("1");
  const [refundTo, setRefundTo] = useState(
    "0x2527D02599Ba641c19FEa793cD0F167589a0f10D"
  );
  const [quote, setQuote] = useState<Quote | null>(null);
  const [unwrapAmount, setUnwrapAmount] = useState("");

  // Load 1Click tokens on mount, default to Ethereum USDC.
  useEffect(() => {
    getTokens()
      .then((t) => {
        setTokens(t);
        const usdc = t.find((x) => x.symbol === "USDC" && x.blockchain === "eth");
        if (usdc) setOriginAsset(usdc.assetId);
      })
      .catch(() => {});
  }, []);

  /** Dry quote only — no swap is executed, no deposit address is returned. */
  const previewSwap = async () => {
    setBusy(true);
    setMessage("");
    try {
      const token = tokens.find((t) => t.assetId === originAsset);
      const decimals = token?.decimals ?? 6;
      const amountSmallest = toSmallestUnit(swapAmount, decimals);
      const q = await requestQuote({
        originAsset,
        amount: amountSmallest,
        recipient: accountId,
        refundTo,
        dry: true,
      });
      setQuote(q);
    } catch (e) {
      setMessage(`Error: ${e}`);
    } finally {
      setBusy(false);
    }
  };

  const unwrap = async () => {
    setBusy(true);
    setMessage("");
    try {
      const result = await unwrapWnear(unwrapAmount);
      setMessage(`Unwrapped: ${result?.transaction?.hash ?? "ok"}`);
    } catch (e) {
      setMessage(`Error: ${e}`);
    } finally {
      setBusy(false);
    }
  };

  const connect = async () => {
    setBusy(true);
    setMessage("");
    try {
      const wallet = await connector.connect();
      const accounts = await wallet.getAccounts();
      setAccountId(accounts[0]?.accountId ?? "");
    } catch (e) {
      setMessage(`Error: ${e}`);
    } finally {
      setBusy(false);
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

  const createSession = async () => {
    setBusy(true);
    setMessage("");
    try {
      const hash = await sha256Hex(code);
      const now = Date.now() * 1_000_000; // ms -> ns
      const end = now + Number(durationMin) * 60 * 1_000_000_000;
      const result = await call(
        "create_session",
        {
          title,
          deposit: nearToYocto(deposit),
          start_time: String(now),
          end_time: String(end),
          code_hash: hash,
        }
      );
      setMessage(`Session created: ${result?.transaction?.hash ?? "ok"}`);
    } catch (e) {
      setMessage(`Error: ${e}`);
    } finally {
      setBusy(false);
    }
  };

  const join = async () => {
    setBusy(true);
    setMessage("");
    try {
      const s = await view<Session>("get_session", { session_id: Number(joinId) });
      if (!s) throw new Error("Session not found");
      const result = await call("join", { session_id: Number(joinId) }, s.deposit);
      setMessage(`Joined: ${result?.transaction?.hash ?? "ok"}`);
    } catch (e) {
      setMessage(`Error: ${e}`);
    } finally {
      setBusy(false);
    }
  };

  const checkIn = async () => {
    setBusy(true);
    setMessage("");
    try {
      const result = await call("check_in", {
        session_id: Number(checkinId),
        code: checkinCode,
      });
      setMessage(`Checked in: ${result?.transaction?.hash ?? "ok"}`);
    } catch (e) {
      setMessage(`Error: ${e}`);
    } finally {
      setBusy(false);
    }
  };

  const settle = async () => {
    setBusy(true);
    setMessage("");
    try {
      const result = await call("settle", { session_id: Number(settleId) });
      setMessage(`Settled: ${result?.transaction?.hash ?? "ok"}`);
    } catch (e) {
      setMessage(`Error: ${e}`);
    } finally {
      setBusy(false);
    }
  };

  const loadSession = async () => {
    setBusy(true);
    setMessage("");
    try {
      const s = await view<Session>("get_session", { session_id: Number(viewId) });
      const p = await view<Participant[]>("get_participants", {
        session_id: Number(viewId),
      });
      setSession(s ?? null);
      setParticipants(p ?? []);
    } catch (e) {
      setMessage(`Error: ${e}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="app">
      <header>
        <h1>Study Pact</h1>
        <p>Put money on showing up. No-shows forfeit their deposit.</p>
        <div className="wallet">
          {accountId ? (
            <>
              <span className="account">{accountId}</span>
              <button onClick={disconnect}>Disconnect</button>
            </>
          ) : (
            <button onClick={connect} disabled={busy}>
              Connect wallet
            </button>
          )}
        </div>
      </header>

      {message && <div className="message">{message}</div>}

      <section>
        <h2>Create session</h2>
        <input
          placeholder="Title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <input
          placeholder="Deposit (NEAR)"
          value={deposit}
          onChange={(e) => setDeposit(e.target.value)}
        />
        <input
          placeholder="Duration (minutes)"
          value={durationMin}
          onChange={(e) => setDurationMin(e.target.value)}
        />
        <input
          placeholder="Check-in code"
          value={code}
          onChange={(e) => setCode(e.target.value)}
        />
        <button onClick={createSession} disabled={busy || !accountId}>
          Create
        </button>
      </section>

      <section>
        <h2>Join</h2>
        <input
          placeholder="Session ID"
          value={joinId}
          onChange={(e) => setJoinId(e.target.value)}
        />
        <button onClick={join} disabled={busy || !accountId}>
          Join
        </button>
      </section>

      <section>
        <h2>Check in</h2>
        <input
          placeholder="Session ID"
          value={checkinId}
          onChange={(e) => setCheckinId(e.target.value)}
        />
        <input
          placeholder="Code"
          value={checkinCode}
          onChange={(e) => setCheckinCode(e.target.value)}
        />
        <button onClick={checkIn} disabled={busy || !accountId}>
          Check in
        </button>
      </section>

      <section>
        <h2>Settle</h2>
        <input
          placeholder="Session ID"
          value={settleId}
          onChange={(e) => setSettleId(e.target.value)}
        />
        <button onClick={settle} disabled={busy || !accountId}>
          Settle
        </button>
      </section>

      <section>
        <h2>Session status</h2>
        <input
          placeholder="Session ID"
          value={viewId}
          onChange={(e) => setViewId(e.target.value)}
        />
        <button onClick={loadSession} disabled={busy}>
          Load
        </button>
        {session && (
          <div className="status">
            <pre>{JSON.stringify(session, null, 2)}</pre>
            <h3>Participants</h3>
            <ul>
              {participants.map((p) => (
                <li key={p.account}>
                  {p.account} — {p.checked_in ? "✅ attended" : "❌ no-show"}
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <section className="quote-panel">
        <h2>
          Join with any token{" "}
          <span className="badge">quote preview — testnet</span>
        </h2>
        <p className="hint">
          This is a <strong>dry quote</strong>: it prices a cross-chain swap to
          wNEAR but executes nothing and moves no funds. The real swap runs on
          NEAR Intents (mainnet only).
        </p>

        <label>Origin token</label>
        <select
          value={originAsset}
          onChange={(e) => setOriginAsset(e.target.value)}
        >
          {tokens.map((t) => (
            <option key={t.assetId} value={t.assetId}>
              {t.symbol} ({t.blockchain})
            </option>
          ))}
        </select>

        <label>Amount</label>
        <input
          placeholder="Amount"
          value={swapAmount}
          onChange={(e) => setSwapAmount(e.target.value)}
        />

        <label>Refund address (origin chain, e.g. Ethereum)</label>
        <input
          placeholder="0x…"
          value={refundTo}
          onChange={(e) => setRefundTo(e.target.value)}
        />

        <button onClick={previewSwap} disabled={busy || !accountId}>
          Preview swap
        </button>

        {quote && (
          <div className="quote-result">
            <h3>Quote (dry run — nothing executed)</h3>
            <pre>{JSON.stringify(quote, null, 2)}</pre>
          </div>
        )}

        <h3>3 steps to join with another token</h3>
        <ol className="steps">
          <li>
            <strong>Swap</strong> — send {swapAmount}{" "}
            {tokens.find((t) => t.assetId === originAsset)?.symbol ?? "token"}{" "}
            on the origin chain to the 1Click deposit address. Receive ≈{" "}
            {quote?.amountOutFormatted ?? "…"} wNEAR on NEAR.
          </li>
          <li>
            <strong>Unwrap wNEAR</strong> — convert wNEAR to native NEAR.
            <div className="unwrap-row">
              <input
                placeholder="wNEAR amount (yocto)"
                value={unwrapAmount}
                onChange={(e) => setUnwrapAmount(e.target.value)}
              />
              <button
                onClick={unwrap}
                disabled={busy || !accountId || !unwrapAmount}
              >
                Unwrap
              </button>
            </div>
          </li>
          <li>
            <strong>Join</strong> — use the <strong>Join</strong> form above with
            the session ID.
          </li>
        </ol>
      </section>
    </div>
  );
}
