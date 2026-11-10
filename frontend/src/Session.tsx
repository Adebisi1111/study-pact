import { useCallback, useEffect, useMemo, useState } from "react";
import {
  call,
  view,
  getTokens,
  requestQuote,
  unwrapWnear,
  withdrawFromIntents,
} from "./near";
import type { Token, Quote } from "./near";
import {
  nsToMs,
  yoctoToNear,
  shortId,
  formatDuration,
  toSmallestUnit,
} from "./config";
import {
  Avatar,
  Chip,
  Skeleton,
  Spinner,
  Stepper,
  TxLink,
  friendlyError,
  isNotFoundError,
} from "./ui";
import { navigate } from "./App";

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

type Props = {
  id: number;
  accountId: string;
  push: (msg: string, type?: "success" | "error" | "info") => void;
  connect: () => void;
  connecting: boolean;
};

type Status = "open" | "live" | "ended" | "settled";

function getStatus(session: Session, now: number): Status {
  if (session.settled) return "settled";
  const start = nsToMs(session.start_time);
  const end = nsToMs(session.end_time);
  if (now < start) return "open";
  if (now <= end) return "live";
  return "ended";
}

function statusLabel(status: Status): string {
  switch (status) {
    case "open":
      return "Open";
    case "live":
      return "Live";
    case "ended":
      return "Ended";
    case "settled":
      return "Settled";
  }
}

function statusTone(status: Status): "open" | "live" | "ended" | "settled" {
  return status;
}

/** Compute the payout and net change per participant from the settlement rules. */
function computePayouts(session: Session, participants: Participant[]) {
  const deposit = BigInt(session.deposit);
  const total = deposit * BigInt(participants.length);
  const attendees = participants.filter((p) => p.checked_in).length;
  const n = participants.length;

  if (n === 0) return [];

  let payouts;
  if (attendees === 0 || attendees === n) {
    payouts = participants.map((p) => ({ ...p, payout: deposit }));
  } else {
    const share = total / BigInt(attendees);
    payouts = participants.map((p) => ({
      ...p,
      payout: p.checked_in ? share : 0n,
    }));
  }

  return payouts.map((p) => {
    const net = p.payout - deposit;
    return {
      ...p,
      net,
      kind: net > 0n ? ("gain" as const) : net < 0n ? ("loss" as const) : ("neutral" as const),
    };
  });
}

export default function Session({ id, accountId, push, connect, connecting }: Props) {
  const [session, setSession] = useState<Session | null>(null);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [checkinCode, setCheckinCode] = useState("");
  const [showPay, setShowPay] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [txHash, setTxHash] = useState("");

  // quote preview state
  const [tokens, setTokens] = useState<Token[]>([]);
  const [originAsset, setOriginAsset] = useState("");
  const [swapAmount, setSwapAmount] = useState("1");
  const [refundTo, setRefundTo] = useState(
    "0x2527D02599Ba641c19FEa793cD0F167589a0f10D"
  );
  const [quote, setQuote] = useState<Quote | null>(null);
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [unwrapAmount, setUnwrapAmount] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const s = await view<Session>("get_session", { session_id: id });
      if (!s) {
        setError("not-found");
        setSession(null);
        setParticipants([]);
      } else {
        let p: Participant[] = [];
        try {
          p = (await view<Participant[]>("get_participants", { session_id: id })) ?? [];
        } catch {
          /* participants are optional for the summary */
        }
        setSession(s);
        setParticipants(p);
      }
    } catch (e) {
      setError(isNotFoundError(e) ? "not-found" : friendlyError(e));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    getTokens()
      .then((t) => {
        setTokens(t);
        const usdc = t.find((x) => x.symbol === "USDC" && x.blockchain === "eth");
        if (usdc) setOriginAsset(usdc.assetId);
      })
      .catch(() => {});
  }, []);

  const me = participants.find((p) => p.account === accountId);
  const joined = Boolean(me);
  const checkedIn = Boolean(me?.checked_in);

  const status = session ? getStatus(session, now) : "open";

  const tokenGroups = useMemo(() => {
    const map = new Map<string, Token[]>();
    for (const token of tokens) {
      if (token.symbol.includes("DEPRECATED")) continue;
      const chain = token.blockchain || "other";
      const list = map.get(chain);
      if (list) list.push(token);
      else map.set(chain, [token]);
    }
    return Array.from(map.entries())
      .map(
        ([chain, list]) =>
          [chain, list.sort((a, b) => a.symbol.localeCompare(b.symbol))] as const
      )
      .sort((a, b) => a[0].localeCompare(b[0]));
  }, [tokens]);

  // Keep the selection valid if the token list changes or filters it out.
  useEffect(() => {
    if (tokenGroups.length === 0) return;
    const exists = tokenGroups.some(([, list]) =>
      list.some((t) => t.assetId === originAsset)
    );
    if (!exists) {
      const first = tokenGroups[0][1][0];
      if (first) setOriginAsset(first.assetId);
    }
  }, [tokenGroups, originAsset]);

  const requireWallet = (): boolean => {
    if (accountId) return true;
    push("Connect your wallet to continue.", "error");
    connect();
    return false;
  };

  const afterTx = (result: { transaction?: { hash?: string } } | undefined, ok: string) => {
    const tx = result?.transaction?.hash ?? "";
    setTxHash(tx);
    push(ok, "success");
    load();
  };

  const join = async () => {
    if (!requireWallet() || !session) return;
    setBusy(true);
    try {
      const result = await call("join", { session_id: id }, session.deposit);
      afterTx(result, "You joined the pact");
    } catch (e) {
      push(friendlyError(e), "error");
    } finally {
      setBusy(false);
    }
  };

  const checkIn = async () => {
    if (!requireWallet()) return;
    if (!checkinCode.trim()) {
      push("Enter the check-in code.", "error");
      return;
    }
    setBusy(true);
    try {
      const result = await call("check_in", { session_id: id, code: checkinCode.trim() });
      afterTx(result, "Checked in — see you there");
      setCheckinCode("");
    } catch (e) {
      push(friendlyError(e), "error");
    } finally {
      setBusy(false);
    }
  };

  const settle = async () => {
    if (!requireWallet()) return;
    setBusy(true);
    try {
      const result = await call("settle", { session_id: id });
      afterTx(result, "Pact settled");
    } catch (e) {
      push(friendlyError(e), "error");
    } finally {
      setBusy(false);
    }
  };

  /* -------- quote preview -------- */

  const previewSwap = async () => {
    if (!requireWallet()) return;
    setBusy(true);
    try {
      const token = tokens.find((t) => t.assetId === originAsset);
      const decimals = token?.decimals ?? 6;
      const q = await requestQuote({
        originAsset,
        amount: toSmallestUnit(swapAmount, decimals),
        recipient: accountId,
        refundTo,
        dry: true,
      });
      setQuote(q);
      push("Quote ready", "success");
    } catch (e) {
      push(friendlyError(e), "error");
    } finally {
      setBusy(false);
    }
  };

  const withdraw = async () => {
    if (!requireWallet()) return;
    setBusy(true);
    try {
      const result = await withdrawFromIntents(withdrawAmount, accountId);
      afterTx(result, "wNEAR withdrawn to your account");
      setWithdrawAmount("");
    } catch (e) {
      push(friendlyError(e), "error");
    } finally {
      setBusy(false);
    }
  };

  const unwrap = async () => {
    if (!requireWallet()) return;
    setBusy(true);
    try {
      const result = await unwrapWnear(unwrapAmount);
      afterTx(result, "Unwrapped to NEAR");
      setUnwrapAmount("");
    } catch (e) {
      push(friendlyError(e), "error");
    } finally {
      setBusy(false);
    }
  };

  /* -------- render -------- */

  if (loading) {
    return (
      <div className="fade-in">
        <button className="back-link" onClick={() => navigate("#/")}>← Back</button>
        <div className="stack">
          <Skeleton height={200} />
          <Skeleton height={120} />
          <Skeleton height={180} />
        </div>
      </div>
    );
  }

  if (error === "not-found") {
    return (
      <div className="fade-in">
        <button className="back-link" onClick={() => navigate("#/")}>← Back</button>
        <div className="card empty">
          <div className="empty-icon">🔍</div>
          <div className="empty-title">No pact with ID {id}</div>
          <p className="muted">
            This pact doesn't exist on testnet. Check the link, or create your
            own.
          </p>
          <div style={{ marginTop: 18 }}>
            <button className="btn btn-primary" onClick={() => navigate("#/create")}>
              Create a pact
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="fade-in">
        <button className="back-link" onClick={() => navigate("#/")}>← Back</button>
        <div className="error-box">
          Couldn't load this pact: {error}
        </div>
        <div style={{ marginTop: 14 }}>
          <button className="btn btn-ghost" onClick={load}>Try again</button>
        </div>
      </div>
    );
  }

  if (!session) return null;

  const depositNear = yoctoToNear(session.deposit);
  const poolNear = yoctoToNear(
    (BigInt(session.deposit) * BigInt(participants.length)).toString()
  );
  const endMs = nsToMs(session.end_time);
  const startMs = nsToMs(session.start_time);
  const remaining =
    status === "live" ? Math.max(0, endMs - now) : status === "open" ? Math.max(0, startMs - now) : 0;

  const payouts = status === "settled" ? computePayouts(session, participants) : null;

  const canJoin = !joined && (status === "open" || status === "live");
  const canCheckIn = joined && !checkedIn && status === "live";
  const canSettle = status === "ended";

  const quoteSteps = [
    { title: "Swap", desc: "Send another token on its chain; receive wNEAR." },
    { title: "Withdraw", desc: "Move wNEAR from your Intents balance to your account." },
    { title: "Unwrap", desc: "Convert wNEAR into native NEAR." },
    { title: "Join", desc: "Deposit the native NEAR into this pact." },
  ];

  return (
    <div className="fade-in">
      <button className="back-link" onClick={() => navigate("#/")}>← Back</button>

      <div className="session-head">
        <div>
          <h1 className="session-title">{session.title || `Pact #${id}`}</h1>
          <div className="session-meta">
            #{id} · host {shortId(session.host, 12, 8)}
          </div>
        </div>
        <Chip tone={statusTone(status)}>{statusLabel(status)}</Chip>
      </div>

      <section className="card pool">
        <div className="pool-label">Pool</div>
        <div className="pool-amount">
          {participants.length > 0 ? poolNear : "0"}
          <span>NEAR</span>
        </div>
        <div className="pool-sub">
          <span>
            <b>{depositNear}</b> NEAR each
          </span>
          <span>
            <b>{participants.length}</b> joined
          </span>
          {remaining > 0 && (
            <span className="countdown">
              {status === "open" ? "starts in " : "ends in "}
              {formatDuration(remaining)}
            </span>
          )}
        </div>
      </section>

      <div className="stack section-gap">
        {/* Context-aware primary action */}
        {(canJoin || canCheckIn || canSettle) && (
          <section className="card">
            {canJoin && (
              <>
                <div className="card-title">Join this pact</div>
                <p className="hint" style={{ marginBottom: 14 }}>
                  Deposit <b className="mono">{depositNear} NEAR</b>. If you show
                  up, you get it back plus a share of the no-shows.
                </p>
                <button
                  className="btn btn-primary btn-block"
                  onClick={join}
                  disabled={busy || connecting}
                >
                  {busy ? <Spinner size={16} /> : `Join for ${depositNear} NEAR`}
                </button>

                <div className="divider" />

                <button
                  className="collapse-toggle"
                  aria-expanded={showPay}
                  onClick={() => setShowPay((v) => !v)}
                >
                  Pay with any token
                  <span className="collapse-caret">▾</span>
                </button>

                {showPay && (
                  <div style={{ marginTop: 8 }}>
                    <span className="badge badge-preview">quote preview — testnet</span>
                    <p className="hint" style={{ marginTop: 10 }}>
                      Price a cross-chain swap to wNEAR. This is a{" "}
                      <b>dry quote</b>: nothing is swapped and no funds move.
                    </p>

                    <div className="field" style={{ marginTop: 12 }}>
                      <label className="label" htmlFor="origin">Origin token</label>
                      <select
                        id="origin"
                        className="select"
                        value={originAsset}
                        onChange={(e) => setOriginAsset(e.target.value)}
                      >
                        {tokenGroups.map(([chain, list]) => (
                          <optgroup key={chain} label={chain}>
                            {list.map((t) => (
                              <option key={t.assetId} value={t.assetId}>
                                {t.symbol}
                              </option>
                            ))}
                          </optgroup>
                        ))}
                      </select>
                    </div>

                    <div className="input-row">
                      <div className="field">
                        <label className="label" htmlFor="amount">Amount</label>
                        <input
                          id="amount"
                          className="input"
                          inputMode="decimal"
                          value={swapAmount}
                          onChange={(e) => setSwapAmount(e.target.value.replace(/[^0-9.]/g, ""))}
                        />
                      </div>
                      <div className="field">
                        <label className="label" htmlFor="refund">Refund addr</label>
                        <input
                          id="refund"
                          className="input"
                          placeholder="0x…"
                          value={refundTo}
                          onChange={(e) => setRefundTo(e.target.value)}
                        />
                      </div>
                    </div>

                    <button
                      className="btn btn-ghost btn-block"
                      onClick={previewSwap}
                      disabled={busy}
                    >
                      Preview swap
                    </button>

                    {quote && (
                      <div className="quote-result" style={{ marginTop: 14 }}>
                        <div className="card-title">Quote (dry run)</div>
                        <p className="hint">
                          You'd receive ≈{" "}
                          <b className="mono">{yoctoToNear(quote.amountOut)}</b>{" "}
                          wNEAR · {quote.timeEstimate}s
                        </p>
                      </div>
                    )}

                    <Stepper steps={quoteSteps} current={0} />

                    <div className="field" style={{ marginTop: 12 }}>
                      <label className="label" htmlFor="withdraw">Withdraw wNEAR</label>
                      <div className="unwrap-row">
                        <input
                          id="withdraw"
                          className="input"
                          inputMode="numeric"
                          placeholder="amount in yocto"
                          value={withdrawAmount}
                          onChange={(e) => setWithdrawAmount(e.target.value.replace(/[^0-9]/g, ""))}
                        />
                        <button
                          className="btn btn-ghost"
                          onClick={withdraw}
                          disabled={busy || !withdrawAmount}
                        >
                          Withdraw
                        </button>
                      </div>
                    </div>

                    <div className="field">
                      <label className="label" htmlFor="unwrap">Unwrap wNEAR</label>
                      <div className="unwrap-row">
                        <input
                          id="unwrap"
                          className="input"
                          inputMode="numeric"
                          placeholder="amount in yocto"
                          value={unwrapAmount}
                          onChange={(e) => setUnwrapAmount(e.target.value.replace(/[^0-9]/g, ""))}
                        />
                        <button
                          className="btn btn-ghost"
                          onClick={unwrap}
                          disabled={busy || !unwrapAmount}
                        >
                          Unwrap
                        </button>
                      </div>
                    </div>

                    <p className="hint">
                      Note: <code>DESTINATION_CHAIN</code> would deliver straight
                      to your account, but the 1Click API currently errors for
                      NEAR routes, so the quote uses <code>INTENTS</code>.
                    </p>
                  </div>
                )}
              </>
            )}

            {canCheckIn && (
              <>
                <div className="card-title">Check in</div>
                <p className="hint" style={{ marginBottom: 14 }}>
                  The session is live. Enter the code the host revealed.
                </p>
                <div className="field">
                  <label className="label" htmlFor="code">Check-in code</label>
                  <input
                    id="code"
                    className="input"
                    placeholder="e.g. pact123"
                    value={checkinCode}
                    onChange={(e) => setCheckinCode(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") checkIn();
                    }}
                  />
                </div>
                <button
                  className="btn btn-primary btn-block"
                  onClick={checkIn}
                  disabled={busy}
                >
                  {busy ? <Spinner size={16} /> : "Check in"}
                </button>
              </>
            )}

            {canSettle && (
              <>
                <div className="card-title">Settle the pact</div>
                <p className="hint" style={{ marginBottom: 14 }}>
                  The session has ended. Attendees split the pool equally;
                  no-shows forfeit their deposit.
                </p>
                <button
                  className="btn btn-primary btn-block"
                  onClick={settle}
                  disabled={busy}
                >
                  {busy ? <Spinner size={16} /> : "Settle"}
                </button>
              </>
            )}
          </section>
        )}

        {/* Participants */}
        <section className="card">
          <div className="card-title">
            Participants · {participants.length}
          </div>
          {participants.length === 0 ? (
            <div className="empty" style={{ padding: "20px 0" }}>
              <div className="empty-icon">👥</div>
              <div className="empty-title">Nobody yet</div>
              <p className="hint">Share the invite link to get the first deposit in.</p>
            </div>
          ) : (
            <div className="participants">
              {participants.map((p) => (
                <div className="participant" key={p.account}>
                  <Avatar name={p.account} />
                  <div className="participant-name">
                    {shortId(p.account, 12, 8)}
                    {p.account === accountId && (
                      <span className="participant-you">you</span>
                    )}
                  </div>
                  {status === "settled" || p.checked_in ? (
                    p.checked_in ? (
                      <Chip tone="checked">Checked in</Chip>
                    ) : (
                      <Chip tone="noshow">No-show</Chip>
                    )
                  ) : joined && p.account === accountId ? (
                    <Chip tone="joined">Joined</Chip>
                  ) : (
                    <Chip tone="neutral">Joined</Chip>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Payout breakdown */}
        {status === "settled" && payouts && (
          <section className="card">
            <div className="card-title">Payouts</div>
            <div className="payout">
              {payouts.map((p) => (
                <div className="payout-row" key={p.account}>
                  <div className="payout-name">
                    {shortId(p.account, 10, 6)}
                    {p.account === accountId && (
                      <span className="participant-you">you</span>
                    )}
                  </div>
                  <div
                    className={`payout-amount ${
                      p.kind === "gain"
                        ? "gain"
                        : p.kind === "loss"
                        ? "loss"
                        : "neutral"
                    }`}
                  >
                    {yoctoToNear(p.net.toString())}
                  </div>
                </div>
              ))}
            </div>
            <p className="hint" style={{ marginTop: 12 }}>
              Any remainder from the split goes to the host.
            </p>
          </section>
        )}

        {txHash && (
          <p className="hint center">
            Last transaction: <TxLink hash={txHash} />
          </p>
        )}
      </div>
    </div>
  );
}
