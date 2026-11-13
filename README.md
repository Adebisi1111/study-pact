# Study Pact

## Put money on showing up

Study Pact is a commitment contract for study sessions. Everyone puts in a small deposit. If you show up, you get your deposit back plus an equal share of what the no-shows forfeited. If nobody shows up, everyone is refunded.

The contract holds the deposits and pays out automatically, so there are no arguments about who actually attended. The host runs check-in, which is a known limitation (see Known limitations).

## Hackathon

All application and contract code was written during the event window (1-14 November 2026). The visual design uses a colour and typography system (tokens in frontend/src/styles.css) that the author has used before.

## How it works

1. The host calls `create_session` with a title, a deposit amount, a start time, an end time and a check-in code. Only the sha256 hash of the code is stored on-chain.
2. Friends call `join` on that session and attach exactly the deposit. Any other amount reverts.
3. At the session, attendees call `check_in` with the code the host reveals. The hash is compared on-chain.
4. After the end time, anyone can call `settle`. The session is marked settled before any transfers, so it cannot pay twice.

Settlement rules:

- If nobody checked in, or everybody checked in, each participant gets their own deposit back.
- Otherwise the attendees split the whole pool equally. Any remainder from integer division goes to the host.
- There is no host-only payout, so the host cannot block the payout.

## Live demo

The frontend is deployed at https://studypakt.vercel.app and runs against NEAR testnet. The contract is `studypact-adebisi.testnet`.

## Try it

### Setup once

- Do: `cd frontend && cp .env.example .env && npm install && npm run dev`
- See: Vite ready and a localhost URL

### 1. Connect wallet

- Do: click Connect wallet, pick a wallet, sign in
- See: your account ID with a Disconnect button

### 2. Create a session

- Do: title `Rust Study Group`, deposit `1`, duration `5`, code `pact123`, then Create
- See: a transaction hash. The code is stored on-chain only as a sha256 hash.

### 3. Join

- Do: open the session and choose Join
- See: the wallet asks for exactly 1 NEAR. After signing, a transaction hash.

### 4. Check in

- Do: enter the code `pact123` and choose Check in
- See: a transaction hash. You are marked attended.

### 5. Settle

- Do: after the end time, choose Settle
- See: a transaction hash. Attendees split the pool; no-shows lose their deposit.

### 6. Join with another token

- Do: in Join with any token, pick a token, enter an amount, choose Preview swap
- See: a dry quote showing the expected wNEAR output. Nothing is swapped and no funds move.

## NEAR integration

| Piece | Choice |
|---|---|
| Contract | Rust with near-sdk 5.30, built and deployed with cargo-near |
| Wallet | @hot-labs/near-connect, which passes the network to the wallet and lets it broadcast |
| Read calls | FastNear testnet RPC, with https://rpc.testnet.near.org as a public fallback |
| Cross-chain join | NEAR Intents 1Click API, dry-quote preview only |
| Unwrap | wrap.near, to turn wNEAR into the native NEAR the contract expects |

Two notes on the integration:

- Transactions are signed and broadcast by the wallet, so they use the wallet's own RPC. The FastNear and fallback endpoints only serve view calls from the frontend.
- NEAR Intents has no testnet, so the cross-chain panel is a preview. It runs a dry quote and shows the steps; it does not execute a swap.

## Design decisions

- Hash the check-in code, never store it. The host stores sha256 of the code. The chain never sees the code, so it cannot leak it.
- Settle marks the session settled before any transfers. Checks-effects-interactions: a second `settle` call reverts, so the pool cannot be paid twice.
- Dust goes to the host. If the pool does not divide evenly by the number of attendees, the remainder is sent to the host. It is negligible, but it is explicit rather than stuck in the contract.
- Anyone can settle. No host-only payout, so the host cannot block the payout.
- Exact-deposit join. Attaching anything other than the exact deposit reverts.

## Known limitations

- The check-in code can be shared. The host controls the code and can hand it to a no-show. Anyone with the code can check in from their own account, but only if they also deposited. There is no proof-of-attendance beyond the code.
- The host controls the check-in window. A hostile host could set a window nobody can attend. Deposits are still refunded if nobody checks in.
- The cross-chain flow is a quote preview. The 1Click panel runs dry quotes on testnet. It shows the price and the steps; it does not execute a swap.
- There is a wNEAR unwrap step. 1Click delivers wNEAR and the contract takes native NEAR, so the user must withdraw from the Intents balance and then unwrap.
- Testnet only. The contract is deployed on testnet. Intents is mainnet-only, so a real cross-chain join needs a mainnet deployment.
- Unaudited. The contract has not been audited. A mainnet deployment holding real deposits would need a review first.

## Run locally

```bash
# contract
cd contract
cargo test

# frontend
cd frontend
cp .env.example .env
npm install
npm run build
npm run dev
```

The frontend reads three optional environment variables:

| Variable | Default |
|---|---|
| VITE_CONTRACT_ID | studypact-adebisi.testnet |
| VITE_RPC_URL | https://test.rpc.fastnear.com |
| VITE_RPC_FALLBACK_URL | https://rpc.testnet.near.org |

## Automated tests

`cargo test` in `contract/` runs 14 tests: 13 unit tests covering session creation, joins, check-in, settlement and the panic cases, plus one integration test that deploys to a local NEAR sandbox and drives a full session end to end.

## License

MIT
