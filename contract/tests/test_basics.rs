use near_api::{AccountId, NearToken};
use near_sdk::serde_json::json;

/// sha256("secret") in lowercase hex.
const CODE_HASH_SECRET: &str = "2bb80d537b1da3e38bd30361aa855686bde0eacd7162fef6a25fe97bf527a25b";

#[derive(near_sdk::serde::Deserialize)]
#[serde(crate = "near_sdk::serde")]
pub struct Participant {
    pub account: AccountId,
    pub checked_in: bool,
}

async fn create_subaccount(
    sandbox: &near_sandbox::Sandbox,
    name: &str,
) -> testresult::TestResult<near_api::Account> {
    let account_id: AccountId = name.parse().unwrap();
    sandbox
        .create_account(account_id.clone().as_str().parse()?)
        .initial_balance(NearToken::from_near(10))
        .send()
        .await?;
    Ok(near_api::Account(account_id))
}

/// End-to-end test in a real sandbox: create, join, check in, settle, verify balances.
async fn test_study_pact_on(contract_wasm: Vec<u8>) -> testresult::TestResult<()> {
    let sandbox = near_sandbox::Sandbox::start_sandbox().await?;
    let sandbox_network =
        near_api::NetworkConfig::from_rpc_url("sandbox", sandbox.rpc_addr.parse()?);

    // Accounts: host runs the session, three friends join.
    let host = create_subaccount(&sandbox, "host.sandbox").await?;
    let alice = create_subaccount(&sandbox, "alice.sandbox").await?;
    let bob = create_subaccount(&sandbox, "bob.sandbox").await?;
    let charlie = create_subaccount(&sandbox, "charlie.sandbox").await?;
    let contract = create_subaccount(&sandbox, "contract.sandbox")
        .await?
        .as_contract();

    let signer = near_api::Signer::from_secret_key(
        near_sandbox::config::DEFAULT_GENESIS_ACCOUNT_PRIVATE_KEY
            .parse()
            .unwrap(),
    )?;

    // Deploy and initialize the contract.
    near_api::Contract::deploy(contract.account_id().clone())
        .use_code(contract_wasm)
        .with_init_call("init", json!({}))?
        .with_signer(signer.clone())
        .send_to(&sandbox_network)
        .await?
        .assert_success();

    // 1. Host creates a session: 1 NEAR deposit, 60 seconds long.
    let now = std::time::SystemTime::now()
        .duration_since(std::time::SystemTime::UNIX_EPOCH)?
        .as_secs();
    let start_time = now * 1_000_000_000;
    let end_time = (now + 60) * 1_000_000_000;

    contract
        .call_function(
            "create_session",
            json!({
                "title": "Rust Study Group",
                "deposit": "1000000000000000000000000",
                "start_time": start_time.to_string(),
                "end_time": end_time.to_string(),
                "code_hash": CODE_HASH_SECRET,
            }),
        )
        .transaction()
        .with_signer(host.account_id().clone(), signer.clone())
        .send_to(&sandbox_network)
        .await?
        .assert_success();

    let session_id = 1u64;

    // 2. Alice, Bob and Charlie each join with exactly 1 NEAR.
    for account in [&alice, &bob, &charlie] {
        contract
            .call_function("join", json!({ "session_id": session_id }))
            .transaction()
            .deposit(NearToken::from_near(1))
            .with_signer(account.account_id().clone(), signer.clone())
            .send_to(&sandbox_network)
            .await?
            .assert_success();
    }

    // 3. Alice and Bob check in with the code. Charlie is a no-show.
    for account in [&alice, &bob] {
        contract
            .call_function(
                "check_in",
                json!({ "session_id": session_id, "code": "secret" }),
            )
            .transaction()
            .with_signer(account.account_id().clone(), signer.clone())
            .send_to(&sandbox_network)
            .await?
            .assert_success();
    }

    // 4. Fast forward past end_time so the session can be settled.
    sandbox.fast_forward(200).await?;

    // 5. Anyone (here: host) settles.
    contract
        .call_function("settle", json!({ "session_id": session_id }))
        .transaction()
        .with_signer(host.account_id().clone(), signer.clone())
        .send_to(&sandbox_network)
        .await?
        .assert_success();

    // 6. Verify state: 3 participants, 2 checked in.
    let participants: Vec<Participant> = contract
        .call_function("get_participants", json!([session_id]))
        .read_only()
        .fetch_from(&sandbox_network)
        .await?
        .data;

    assert_eq!(participants.len(), 3);
    let checked_in = participants.iter().filter(|p| p.checked_in).count();
    assert_eq!(checked_in, 2);

    // 7. Verify balances: pool is 3 NEAR, split between 2 attendees = 1.5 NEAR each.
    // Alice:   10 - 1 + 1.5 = 10.5 NEAR
    // Bob:     10 - 1 + 1.5 = 10.5 NEAR
    // Charlie: 10 - 1 + 0   = 9 NEAR
    let alice_balance = alice
        .tokens()
        .near_balance()
        .fetch_from(&sandbox_network)
        .await?
        .total;
    let bob_balance = bob
        .tokens()
        .near_balance()
        .fetch_from(&sandbox_network)
        .await?
        .total;
    let charlie_balance = charlie
        .tokens()
        .near_balance()
        .fetch_from(&sandbox_network)
        .await?
        .total;

    // Allow a small margin for gas.
    assert!(
        alice_balance > NearToken::from_millinear(10_490),
        "alice should have ~10.5 NEAR, got {} yoctoNEAR",
        alice_balance.as_yoctonear()
    );
    assert!(
        bob_balance > NearToken::from_millinear(10_490),
        "bob should have ~10.5 NEAR, got {} yoctoNEAR",
        bob_balance.as_yoctonear()
    );
    assert!(
        charlie_balance < NearToken::from_millinear(9_010),
        "charlie should have ~9 NEAR, got {} yoctoNEAR",
        charlie_balance.as_yoctonear()
    );

    Ok(())
}

#[tokio::test]
async fn test_contract_is_operational() -> testresult::TestResult<()> {
    let contract_wasm_path = cargo_near_build::build_with_cli(Default::default())?;
    let contract_wasm = std::fs::read(contract_wasm_path)?;

    test_study_pact_on(contract_wasm).await
}
