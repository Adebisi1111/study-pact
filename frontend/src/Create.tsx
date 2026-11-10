import { useState } from "react";
import { call, view, sha256Hex } from "./near";
import { nearToYocto } from "./config";
import { friendlyError, Spinner, TxLink } from "./ui";
import { navigate } from "./App";
import { ArrowRightIcon, CheckIcon, CopyIcon, PenIcon } from "./icons";

type Props = {
  accountId: string;
  push: (msg: string, type?: "success" | "error" | "info") => void;
  connect: () => void;
  connecting: boolean;
};

export default function Create({ accountId, push, connect, connecting }: Props) {
  const [title, setTitle] = useState("");
  const [deposit, setDeposit] = useState("1");
  const [startMin, setStartMin] = useState("10");
  const [durationMin, setDurationMin] = useState("60");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [createdId, setCreatedId] = useState<number | null>(null);
  const [txHash, setTxHash] = useState("");
  const [copied, setCopied] = useState(false);

  const create = async () => {
    if (!accountId) {
      push("Connect your wallet first.", "error");
      connect();
      return;
    }
    if (!title.trim()) {
      push("Give your pact a title.", "error");
      return;
    }
    if (!code.trim()) {
      push("Set a check-in code — you'll reveal it at the session.", "error");
      return;
    }

    setBusy(true);
    try {
      const hash = await sha256Hex(code.trim());
      const start = Date.now() * 1_000_000 + Number(startMin || 0) * 60 * 1_000_000_000;
      const end = start + Number(durationMin || 0) * 60 * 1_000_000_000;

      const result = await call("create_session", {
        title: title.trim(),
        deposit: nearToYocto(deposit || "0"),
        start_time: String(start),
        end_time: String(end),
        code_hash: hash,
      });

      const tx = result?.transaction?.hash ?? "";
      setTxHash(tx);
      // next_session_id is the *next* id, so ours is one less.
      const next = await view<{ next_session_id?: number }>("next_session_id", {});
      const id = next?.next_session_id;
      const sessionId = id ? Number(id) - 1 : 1;
      setCreatedId(sessionId);
      push("Pact created", "success");
    } catch (e) {
      push(friendlyError(e), "error");
    } finally {
      setBusy(false);
    }
  };

  const inviteUrl = createdId
    ? `${window.location.origin}${window.location.pathname}#/session/${createdId}`
    : "";

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
      push("Invite link copied", "success");
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      push("Copy failed — select the link manually.", "error");
    }
  };

  if (createdId) {
    return (
      <div className="fade-in page-narrow">
        <button className="back-link" onClick={() => navigate("#/")}>
          ← Back
        </button>

        <section className="card card-pad-lg center">
          <div className="spectral-sm" />
          <div
            style={{
              width: 48,
              height: 48,
              borderRadius: 999,
              background: "rgba(26,128,71,0.12)",
              color: "var(--success)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              margin: "0 auto 16px",
            }}
          >
            <CheckIcon size={24} />
          </div>
          <h2 style={{ fontSize: 24, marginBottom: 10 }}>Pact created!</h2>
          <p className="muted" style={{ marginBottom: 22 }}>
            Pact #{createdId} is live. Share the link with your study group —
            anyone with it can open the pact and join.
          </p>

          <div
            style={{
              background: "var(--surface-muted)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-sm)",
              padding: "12px 14px",
              marginBottom: 18,
            }}
          >
            <p
              style={{
                fontSize: 11,
                fontWeight: 600,
                letterSpacing: "0.07em",
                textTransform: "uppercase",
                color: "var(--muted)",
                marginBottom: 4,
              }}
            >
              Share link
            </p>
            <p
              className="mono"
              style={{
                fontSize: 13,
                color: "var(--ink)",
                wordBreak: "break-all",
              }}
            >
              {inviteUrl}
            </p>
          </div>

          <div className="hero-actions">
            <button className="btn btn-primary" onClick={copy}>
              {copied ? <CheckIcon size={15} /> : <CopyIcon size={15} />}
              {copied ? "Copied!" : "Copy link"}
            </button>
            <button
              className="btn btn-ghost"
              onClick={() => navigate(`#/session/${createdId}`)}
            >
              Open the pact
              <ArrowRightIcon size={15} />
            </button>
          </div>

          {txHash && (
            <p className="hint" style={{ marginTop: 20 }}>
              Transaction: <TxLink hash={txHash} />
            </p>
          )}
        </section>
      </div>
    );
  }

  return (
    <div className="fade-in page-narrow">
      <button className="back-link" onClick={() => navigate("#/")}>
        ← Back
      </button>

      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 26, marginBottom: 6 }}>Create a pact</h1>
        <p className="hint">
          Set the stakes. Your friends deposit the same amount, and the contract
          splits the pot after the session.
        </p>
      </div>

      {!accountId && (
        <div className="card center" style={{ marginBottom: 16 }}>
          <PenIcon
            size={26}
            style={{ color: "var(--accent)", margin: "0 auto 10px" }}
          />
          <p className="muted" style={{ marginBottom: 14 }}>
            Connect your wallet to create a pact — you'll be the host.
          </p>
          <button className="btn btn-primary" onClick={connect}>
            <PenIcon size={15} />
            Connect wallet
          </button>
        </div>
      )}

      <section className="card">
        <div className="field">
          <label className="label" htmlFor="title">
            Title
          </label>
          <input
            id="title"
            className="input"
            placeholder="e.g. Rust Study Group"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>

        <div className="input-row">
          <div className="field">
            <label className="label" htmlFor="deposit">
              Deposit (NEAR)
            </label>
            <input
              id="deposit"
              className="input"
              inputMode="decimal"
              placeholder="1"
              value={deposit}
              onChange={(e) => setDeposit(e.target.value.replace(/[^0-9.]/g, ""))}
            />
          </div>
          <div className="field">
            <label className="label" htmlFor="code">
              Check-in code
            </label>
            <input
              id="code"
              className="input"
              placeholder="pact123"
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
          </div>
        </div>

        <div className="input-row">
          <div className="field">
            <label className="label" htmlFor="startMin">
              Starts in (min)
            </label>
            <input
              id="startMin"
              className="input"
              inputMode="numeric"
              value={startMin}
              onChange={(e) => setStartMin(e.target.value.replace(/[^0-9]/g, ""))}
            />
          </div>
          <div className="field">
            <label className="label" htmlFor="durationMin">
              Lasts (min)
            </label>
            <input
              id="durationMin"
              className="input"
              inputMode="numeric"
              value={durationMin}
              onChange={(e) => setDurationMin(e.target.value.replace(/[^0-9]/g, ""))}
            />
          </div>
        </div>

        <div className="divider" />

        <button
          className="btn btn-primary btn-block"
          onClick={create}
          disabled={busy || connecting}
        >
          {busy ? (
            <>
              <Spinner size={16} /> Creating…
            </>
          ) : (
            <>
              <PenIcon size={15} /> Create pact
            </>
          )}
        </button>

        {!accountId && (
          <p className="hint center" style={{ marginTop: 12 }}>
            You'll be asked to connect your wallet to sign the transaction.
          </p>
        )}
      </section>
    </div>
  );
}
