import { useEffect, useState } from "react";
import { view, getLatestSessionId } from "./near";
import {
  DEMO_SESSION_ID,
  formatDuration,
  nsToMs,
  shortId,
  yoctoToNear,
} from "./config";
import { Avatar, Chip, Skeleton } from "./ui";
import { navigate } from "./App";
import { ArrowRightIcon, ClockIcon } from "./icons";

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

const MAX_CHIPS = 4;

/**
 * Live preview of a real pact, read from the contract.
 * Uses VITE_DEMO_SESSION_ID when set, otherwise the latest session.
 * Renders nothing if the contract call fails or no session exists.
 */
export default function HomePactCard() {
  const [session, setSession] = useState<Session | null>(null);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        let id = DEMO_SESSION_ID;
        if (!id) {
          id = await getLatestSessionId();
        }
        if (!id || id <= 0) {
          setFailed(true);
          return;
        }

        const [s, p] = await Promise.all([
          view<Session>("get_session", { session_id: id }),
          view<Participant[]>("get_participants", { session_id: id }).catch(
            () => [] as Participant[]
          ),
        ]);
        if (!s) {
          setFailed(true);
          return;
        }
        if (!cancelled) {
          setSession(s);
          setParticipants(p ?? []);
        }
      } catch {
        if (!cancelled) setFailed(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  if (loading) {
    return (
      <div className="card home-pact-loading" aria-hidden="true">
        <Skeleton height={16} width={110} />
        <div style={{ height: 12 }} />
        <Skeleton height={26} width="60%" />
        <div style={{ height: 14 }} />
        <Skeleton height={38} width={150} />
        <div style={{ height: 14 }} />
        <Skeleton height={14} width="80%" />
      </div>
    );
  }

  if (failed || !session) return null;

  const status = getStatus(session, now);
  const depositNear = yoctoToNear(session.deposit);
  const poolNear = yoctoToNear(
    (BigInt(session.deposit) * BigInt(participants.length)).toString()
  );
  const endMs = nsToMs(session.end_time);
  const startMs = nsToMs(session.start_time);
  const remaining =
    status === "live"
      ? Math.max(0, endMs - now)
      : status === "open"
      ? Math.max(0, startMs - now)
      : 0;

  const shown = participants.slice(0, MAX_CHIPS);
  const extra = participants.length - shown.length;

  return (
    <button
      className="card home-pact"
      onClick={() => navigate(`#/session/${session.id}`)}
      aria-label={`Open pact ${session.title || session.id}`}
    >
      <div className="home-pact-head">
        <span className="home-pact-label">
          {DEMO_SESSION_ID ? "Featured pact" : "Latest pact"}
        </span>
        <Chip tone={status}>{statusLabel(status)}</Chip>
      </div>

      <h3>{session.title || `Pact #${session.id}`}</h3>

      <div>
        <span className="home-pact-amount">
          {participants.length > 0 ? poolNear : "0"}
        </span>
        <span className="home-pact-unit">NEAR</span>
      </div>

      <div className="home-pact-meta">
        <span>
          <b>{depositNear}</b> NEAR each
        </span>
        <span>
          <b>{participants.length}</b> joined
        </span>
        {remaining > 0 && (
          <span className="countdown">
            <ClockIcon size={12} />
            {status === "open" ? "starts in " : "ends in "}
            {formatDuration(remaining)}
          </span>
        )}
      </div>

      {participants.length > 0 && (
        <div className="home-pact-avatars">
          {shown.map((p) => (
            <Avatar key={p.account} name={p.account} />
          ))}
          {extra > 0 && <span className="avatar-more">+{extra}</span>}
        </div>
      )}

      <span className="home-pact-cta">
        {participants.length === 0
          ? `Open pact #${session.id}`
          : `Open pact #${session.id} · host ${shortId(session.host, 6, 4)}`}
        <ArrowRightIcon size={14} />
      </span>
    </button>
  );
}
