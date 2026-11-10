# Study Pact

Study Pact is a commitment contract for study sessions. Everyone puts in a small deposit. If you show up, you get your deposit back plus an equal share of what the no-shows forfeited. If nobody shows up, everyone is refunded.

Built at **NEAR HACKATHON** ([nearhackathon.com](https://nearhackathon.com)) — tracks: `social`, `realworld`, `agents`.

---

## Why I built it

I'm finishing my final year, and I kept planning study sessions that I then skipped. Reminders and calendar invites didn't work; losing money does.

While working on my final year project, I watched study groups fall apart again and again. Everyone agreed on a time, a few people showed up, and the rest had an excuse. Reminders and group chats didn't fix it, but I noticed people take commitments seriously when something is at stake.

Study Pact puts that stake on-chain. The contract holds the deposits and pays out automatically, so there are no arguments about who actually showed up.

## Hackathon

Study Pact was built independently for NEAR HACKATHON, during the event window (1-14 November 2026).

## How it works

1. The **host** creates a session: title, deposit amount, start/end time, and a check-in code (only its hash is stored).
2. **Friends join** by attaching exactly the deposit.
3. At the session, attendees **check in** with the code the host reveals.
4. After the end time, **anyone can settle**: attendees split the whole pool equally. If nobody checked in, everyone is refunded. If everyone checked in, everyone gets their own deposit back.

## NEAR tools used

| Tool | Where | What it does |
|---|---|---|
| [NEAR Protocol](https://docs.near.org/) (testnet) | contract | holds deposits, tracks attendance, pays out |
| [NEAR Intents / 1Click API](https://docs.near-intents.org/) | frontend | quotes a cross-chain swap to wNEAR |
| [wrap.near](https://github.com/near/core-contracts) | frontend | unwraps wNEAR into native NEAR |
| [intents.near](https://docs.near-intents.org/integration/verifier-contract/deposits-and-withdrawals/withdrawals.md) | frontend | withdraws wNEAR from the Intents balance |
| [near-api-js](https://docs.near.org/web3-apps/quickstart) | frontend | wallet + RPC calls |
| [@hot-labs/near-connect](https://docs.near.org/web3-apps/tutorials/wallet-login) | frontend | wallet connection |
| [cargo-near / near-sdk](https://docs.near.org/smart-contracts/quickstart) | contract | build + deploy |

## "do X, see Y"

### Setup (once)

- **Do:** `cd frontend && cp .env.example .env && npm install && npm run dev`
- **See:** Vite ready and a localhost URL (e.g. `http://localhost:5175`)

### 1. Connect wallet
- **Do:** click **Connect wallet**, pick a wallet, sign in
- **See:** your account ID with a **Disconnect** button

### 2. Create a session
- **Do:** Title `Rust Study Group`, Deposit `1`, Duration `5`, code `pact123` → **Create**
- **See:** a transaction hash. The code is stored on-chain only as a sha256 hash.

### 3. Join
- **Do:** Session ID `1` → **Join**
- **See:** the wallet asks for exactly 1 NEAR. After signing, a transaction hash.

### 4. Check in
- **Do:** Session ID `1`, code `pact123` → **Check in**
- **See:** a transaction hash. You are marked attended.

### 5. Settle (after the duration)
- **Do:** Session ID `1` → **Settle**
- **See:** a transaction hash. Attendees split the pool; no-shows lose their deposit.

### 6. Session status
- **Do:** Session ID `1` → **Load**
- **See:** the session object plus the participant list with ✅ attended / ❌ no-show.

### 7. Join with another token (quote preview)
- **Do:** in **Join with any token**, pick a token, enter an amount, click **Preview swap**
- **See:** a dry quote showing the expected wNEAR output. Nothing is swapped and no funds move.

## Design decisions

- **Hash the check-in code, never store it.** The host stores `sha256(code)`. The chain never sees the code, so it can't leak it.
- **Settle marks the session settled before any transfers.** Checks-effects-interactions: a second `settle` call reverts, so the pool can't be paid twice.
- **Dust goes to the host.** If the pool doesn't divide evenly by the number of attendees, the remainder (1–2 yoctoNEAR) is sent to the host. It's negligible, but it's explicit rather than stuck in the contract.
- **Anyone can settle.** No host-only payout, so the host can't block the payout.
- **Exact-deposit join.** Attaching anything other than the exact deposit reverts.

## Known limitations

- **The check-in code can be shared.** The host controls the code and can hand it to a no-show. Anyone with the code can check in from their own account — but only if they also deposited. There is no proof-of-attendance beyond the code.
- **The host controls the check-in window.** A hostile host could set a window nobody can attend. Deposits are still refunded if nobody checks in.
- **The cross-chain flow is a quote preview.** The 1Click panel runs `dry: true` quotes on testnet. It shows the price and the steps; it does not execute a swap.
- **There is a wNEAR unwrap step.** 1Click delivers wNEAR, and the contract takes native NEAR, so the user must withdraw from the Intents balance and then unwrap.
- **`DESTINATION_CHAIN` is broken for NEAR.** It would deliver straight to the account, but the [1Click API](https://docs.near-intents.org/) currently returns an error for NEAR routes, so the panel uses `INTENTS`.
- **Testnet only.** The contract is deployed on testnet. Intents is mainnet-only, so a real cross-chain join needs a mainnet deployment.

## Next steps

- Mainnet deployment with tiny deposits to prove a real cross-chain join end-to-end.
- AI referee on NEAR AI Cloud that helps verify check-ins and nudges participants.
- Host reputation / session history.
- NEP-141 deposits so the contract accepts wNEAR directly and skips the unwrap step.

## Repo layout

```
contract/    Rust NEAR contract (near-sdk 5.30) + tests
frontend/    React + Vite web UI (near-api-js 7.4, @hot-labs/near-connect)
```

## License

MIT
