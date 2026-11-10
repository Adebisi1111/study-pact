import { useCallback, useEffect, useState } from "react";
import { view, getLatestSessionId } from "./near";
import { HIDE_SESSION_IDS, nsToMs, yoctoToNear } from "./config";
import { Chip, Skeleton } from "./ui";
import { navigate } from "./App";
import { ArrowRightIcon, UsersIcon } from "./icons";

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

type Pact = { session: Session; participants: Participant[] };

type Status = "open" | "live" | "ended" | "settled";

/** Slim shape persisted in sessionStorage — public chain data only. */
type CachedPact = {
  id: number;
  title: string;
  host: string;
  deposit: string;
  start_time: string;
  end_time: string;
  settled: boolean;
  participants: Participant[];
};

const MAX_PACTS = 10;
const CONCURRENCY = 4;
const CACHE_KEY = "studypact:recent-pacts-v1";

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

/** Run `fn` over `ids` with a bounded number of in-flight calls. */
async function mapWithConcurrency<T, R>(
  ids: T[],
  concurrency: number,
  fn: (id: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = [];
  for (let index = 0; index < ids.length; index += concurrency) {
    const batch = ids.slice(index, index + concurrency);
    results.push(...(await Promise.all(batch.map(fn))));
  }
  return results;
}

async function fetchPact(id: number): Promise<Pact | null> {
  try {
    const [session, participants] = await Promise.all([
      view<Session>("get_session", { session_id: id }).catch(() => null),
      view<Participant[]>("get_participants", { session_id: id }).catch(
        () => [] as Participant[]
      ),
    ]);
    if (!session) return null;
    return { session, participants: participants ?? [] };
  } catch {
    return null;
  }
}

/* -------------------------------------------------------------------------- */
/* sessionStorage cache — public chain data only, no keys or secrets          */
/* -------------------------------------------------------------------------- */

function toCached(pacts: Pact[]): CachedPact[] {
  return pacts.map((pact) => ({
    id: pact.session.id,
    title: pact.session.title,
    host: pact.session.host,
    deposit: pact.session.deposit,
    start_time: pact.session.start_time,
    end_time: pact.session.end_time,
    settled: pact.session.settled,
    participants: pact.participants,
  }));
}

function fromCached(items: CachedPact[]): Pact[] {
  return items.map((item) => ({
    session: {
      id: item.id,
      title: item.title,
      host: item.host,
      deposit: item.deposit,
      start_time: item.start_time,
      end_time: item.end_time,
      code_hash: "",
      settled: item.settled,
    },
    participants: item.participants ?? [],
  }));
}

function readCache(): Pact[] {
  try {
    const raw = sessionStorage.getItem(CACHE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return fromCached(parsed as CachedPact[]).slice(0, MAX_PACTS);
  } catch {
    return [];
  }
}

function writeCache(pacts: Pact[]): void {
  try {
    sessionStorage.setItem(CACHE_KEY, JSON.stringify(toCached(pacts)));
  } catch {
    /* storage blocked or full — caching is best-effort */
  }
}

export default function RecentPacts({ accountId }: { accountId: string }) {
  const [pacts, setPacts] = useState<Pact[]>(() => readCache());
  const [loading, setLoading] = useState(() => readCache().length === 0);
  const [refreshing, setRefreshing] = useState(() => readCache().length > 0);
  const [failed, setFailed] = useState(false);
  const [tab, setTab] = useState<"recent" | "mine">("recent");
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    setRefreshing(true);
    setFailed(false);
    try {
      const latest = await getLatestSessionId();
      if (!latest || latest <= 0) {
        setPacts([]);
        writeCache([]);
        return;
      }

      const ids: number[] = [];
      for (let id = latest; id >= 1 && ids.length < MAX_PACTS; id -= 1) {
        if (HIDE_SESSION_IDS.includes(id)) continue;
        ids.push(id);
      }

      let loaded = 0;
      await mapWithConcurrency(ids, CONCURRENCY, async (id) => {
        const pact = await fetchPact(id);
        if (!pact) return;
        loaded += 1;
        // Render each card as soon as its own data lands.
        setPacts((current) => {
          if (current.some((entry) => entry.session.id === pact.session.id)) {
            return current;
          }
          return [...current, pact].sort(
            (a, b) => b.session.id - a.session.id
          );
        });
      });

      if (loaded === 0 && ids.length > 0) setFailed(true);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  // Persist the settled list for the next visit.
  useEffect(() => {
    if (!loading && !refreshing && pacts.length > 0) {
      writeCache(pacts);
    }
  }, [loading, refreshing, pacts]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  // "My pacts" only needs the participant checks once a wallet is connected.
  const mine = accountId
    ? pacts.filter(
        (pact) =>
          pact.session.host === accountId ||
          pact.participants.some((p) => p.account === accountId)
      )
    : [];

  const shown = tab === "mine" ? mine : pacts;

  return (
    <section className="card">
      <div className="card-head">
        <div className="card-title" style={{ marginBottom: 0 }}>
          Recent pacts
        </div>
        {accountId && (
          <div className="tabs" role="tablist">
            <button
              className={`tab ${tab === "recent" ? "active" : ""}`}
              role="tab"
              aria-selected={tab === "recent"}
              onClick={() => setTab("recent")}
            >
              Recent
            </button>
            <button
              className={`tab ${tab === "mine" ? "active" : ""}`}
              role="tab"
              aria-selected={tab === "mine"}
              onClick={() => setTab("mine")}
            >
              My pacts {mine.length > 0 && `· ${mine.length}`}
            </button>
          </div>
        )}
      </div>

      {refreshing && !loading && (
        <p className="hint" style={{ marginBottom: 10 }}>
          Refreshing…
        </p>
      )}

      {loading && pacts.length === 0 ? (
        <div className="pact-list" aria-hidden="true">
          <p className="hint" style={{ marginBottom: 12 }}>
            Loading pacts from NEAR testnet…
          </p>
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="pact-skeleton">
              <Skeleton height={16} width="55%" />
              <div style={{ height: 8 }} />
              <Skeleton height={13} width="35%" />
            </div>
          ))}
        </div>
      ) : failed && pacts.length === 0 ? (
        <div className="empty" style={{ padding: "20px 0" }}>
          <div className="empty-title">Couldn't load pacts</div>
          <p className="hint" style={{ marginBottom: 14 }}>
            The contract call failed. Check your connection and try again.
          </p>
          <button className="btn btn-ghost btn-sm" onClick={load}>
            Try again
          </button>
        </div>
      ) : shown.length === 0 ? (
        <div className="empty" style={{ padding: "20px 0" }}>
          <div className="empty-icon">
            <UsersIcon size={28} />
          </div>
          <div className="empty-title">
            {tab === "mine" ? "You're not in any pacts yet" : "No pacts yet"}
          </div>
          <p className="hint">
            {tab === "mine"
              ? "Join a pact or create your own — it'll show up here."
              : "Create the first one."}
          </p>
          {tab !== "mine" && (
            <div style={{ marginTop: 16 }}>
              <button
                className="btn btn-primary btn-sm"
                onClick={() => navigate("#/create")}
              >
                Create a pact
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="pact-list">
          {shown.map((pact) => {
            const status = getStatus(pact.session, now);
            const pool = yoctoToNear(
              (
                BigInt(pact.session.deposit) * BigInt(pact.participants.length)
              ).toString()
            );
            return (
              <button
                key={pact.session.id}
                className="pact-row"
                onClick={() => navigate(`#/session/${pact.session.id}`)}
              >
                <div className="pact-row-head">
                  <span className="pact-row-title">
                    {pact.session.title || `Pact #${pact.session.id}`}
                  </span>
                  <Chip tone={status}>{statusLabel(status)}</Chip>
                </div>
                <div className="pact-row-meta">
                  <span>
                    <b>{pool}</b> NEAR pool
                  </span>
                  <span>
                    <b>{pact.participants.length}</b> joined
                  </span>
                </div>
                <span className="pact-row-cta">
                  Open pact #{pact.session.id}
                  <ArrowRightIcon size={13} />
                </span>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}
