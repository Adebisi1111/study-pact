import { useState } from "react";
import { navigate } from "./App";

const HOW_IT_WORKS = [
  {
    title: "Deposit",
    desc: "Everyone puts in the same amount. The contract holds it — nobody can run off with the pot.",
  },
  {
    title: "Show up",
    desc: "At the session, the host reveals a code. Check in from your account to prove you were there.",
  },
  {
    title: "Split the pot",
    desc: "After the session, attendees split the whole pool equally. No-shows forfeit their deposit.",
  },
];

export default function Home({ accountId }: { accountId: string }) {
  const [openId, setOpenId] = useState("");

  const openPact = () => {
    const id = openId.trim();
    if (!id) return;
    navigate(`#/session/${id}`);
  };

  return (
    <div>
      <section className="hero">
        <h1>
          Put money on <em>showing up</em>.
        </h1>
        <p>
          Study Pact is a commitment contract for study sessions. Deposit a
          little, show up, and split what the no-shows left behind.
        </p>
        <div className="hero-actions">
          <button
            className="btn btn-primary"
            onClick={() => navigate("#/create")}
          >
            Create a pact
          </button>
          <a
            className="btn btn-ghost"
            href={accountId ? "#/create" : undefined}
            onClick={(e) => {
              if (!accountId) {
                e.preventDefault();
                navigate("#/create");
              }
            }}
          >
            How it works ↓
          </a>
        </div>
      </section>

      <section className="card">
        <div className="card-title">How it works</div>
        <div className="steps">
          {HOW_IT_WORKS.map((step, index) => (
            <div className="step" key={step.title}>
              <div className="step-num">{index + 1}</div>
              <div className="step-body">
                <div className="step-title">{step.title}</div>
                <div className="step-desc">{step.desc}</div>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="card section-gap">
        <div className="card-title">Open a pact</div>
        <p className="hint" style={{ marginBottom: 14 }}>
          Got an invite link or a pact ID? Paste it here.
        </p>
        <div className="field">
          <label className="label" htmlFor="open-id">
            Pact ID
          </label>
          <input
            id="open-id"
            className="input"
            inputMode="numeric"
            placeholder="e.g. 1"
            value={openId}
            onChange={(e) => setOpenId(e.target.value.replace(/[^0-9]/g, ""))}
            onKeyDown={(e) => {
              if (e.key === "Enter") openPact();
            }}
          />
        </div>
        <button
          className="btn btn-ghost btn-block"
          onClick={openPact}
          disabled={!openId}
        >
          Open pact
        </button>
      </section>

      <p className="hint center section-gap">
        Testnet only · Deployed at{" "}
        <span className="mono">studypact-adebisi.testnet</span>
      </p>
    </div>
  );
}
