use near_sdk::collections::{LookupMap, Vector};
use near_sdk::json_types::{U128, U64};
use near_sdk::{AccountId, NearToken, PanicOnDefault, Promise, env, near, require};

/// A study session created by a host.
#[near(serializers = [json, borsh])]
#[derive(Clone)]
pub struct Session {
    pub id: u64,
    pub title: String,
    pub host: AccountId,
    pub deposit: U128,      // deposit each participant must attach, in yoctoNEAR
    pub start_time: U64,    // nanoseconds
    pub end_time: U64,      // nanoseconds
    pub code_hash: String,  // hex sha256 of the check-in code (never the code itself)
    pub settled: bool,
}

/// A participant in a session.
#[near(serializers = [json, borsh])]
#[derive(Clone)]
pub struct Participant {
    pub account: AccountId,
    pub checked_in: bool,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Contract {
    sessions: LookupMap<u64, Session>,
    participants: LookupMap<u64, Vector<Participant>>,
    next_session_id: u64,
}

/// Encode bytes as lowercase hex (no external dependency).
fn hex_encode(bytes: &[u8]) -> String {
    let mut s = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        s.push_str(&format!("{:02x}", b));
    }
    s
}

#[near]
impl Contract {
    #[init]
    pub fn init() -> Self {
        Self {
            sessions: LookupMap::new(b"s".to_vec()),
            participants: LookupMap::new(b"p".to_vec()),
            next_session_id: 1,
        }
    }

    /// Create a new study session. The host stores only the hash of the check-in code.
    pub fn create_session(
        &mut self,
        title: String,
        deposit: U128,
        start_time: U64,
        end_time: U64,
        code_hash: String,
    ) -> u64 {
        require!(end_time.0 > start_time.0, "end_time must be after start_time");
        require!(deposit.0 > 0, "deposit must be greater than 0");

        let host = env::predecessor_account_id();
        let id = self.next_session_id;
        self.next_session_id += 1;

        let session = Session {
            id,
            title,
            host,
            deposit,
            start_time,
            end_time,
            code_hash,
            settled: false,
        };
        self.sessions.insert(&id, &session);
        self.participants
            .insert(&id, &Vector::new(format!("p{}", id).into_bytes()));

        id
    }

    /// Join a session by attaching exactly the deposit amount.
    #[payable]
    pub fn join(&mut self, session_id: u64) {
        let session = self.sessions.get(&session_id).expect("Session not found");
        require!(!session.settled, "Session already settled");
        require!(
            env::block_timestamp() < session.end_time.0,
            "Session has ended"
        );

        let deposit = env::attached_deposit();
        require!(
            deposit.as_yoctonear() == session.deposit.0,
            "Must attach exactly the deposit amount"
        );

        let account = env::predecessor_account_id();
        let mut participants = self
            .participants
            .get(&session_id)
            .expect("Participants not found");
        require!(
            !participants.iter().any(|p| p.account == account),
            "Already joined"
        );

        participants.push(&Participant {
            account,
            checked_in: false,
        });
        self.participants.insert(&session_id, &participants);
    }

    /// Check in with the code the host reveals. The code is hashed and compared
    /// against the stored hash, so the code itself is never stored on chain.
    pub fn check_in(&mut self, session_id: u64, code: String) {
        let session = self.sessions.get(&session_id).expect("Session not found");
        let now = env::block_timestamp();
        require!(
            now >= session.start_time.0 && now <= session.end_time.0,
            "Not within session time"
        );

        let account = env::predecessor_account_id();
        let mut participants = self
            .participants
            .get(&session_id)
            .expect("Participants not found");

        let idx = participants
            .iter()
            .position(|p| p.account == account)
            .expect("Not a participant") as u64;

        let hash = hex_encode(&env::sha256(code.as_bytes()));
        require!(hash == session.code_hash, "Wrong check-in code");

        let mut p = participants.get(idx).unwrap();
        p.checked_in = true;
        participants.replace(idx, &p);
        self.participants.insert(&session_id, &participants);
    }

    /// Settle a session after end_time. Attendees split the whole pool equally.
    ///
    /// - If nobody checked in, everyone is refunded their deposit.
    /// - If everyone checked in, everyone gets their own deposit back.
    /// - Otherwise, attendees split the pool equally. Any remainder (dust) from
    ///   integer division goes to the host.
    ///
    /// The session is marked settled BEFORE any transfers, so it cannot pay twice.
    pub fn settle(&mut self, session_id: u64) {
        let mut session = self.sessions.get(&session_id).expect("Session not found");
        require!(!session.settled, "Session already settled");
        require!(
            env::block_timestamp() >= session.end_time.0,
            "Session has not ended yet"
        );

        // Mark settled BEFORE transfers (checks-effects-interactions).
        session.settled = true;
        self.sessions.insert(&session_id, &session);

        let participants = self
            .participants
            .get(&session_id)
            .expect("Participants not found");
        let total = participants.len();
        let attendees = participants.iter().filter(|p| p.checked_in).count() as u64;
        let pool = session.deposit.0 * total as u128;

        if attendees == 0 || attendees == total {
            // Everyone gets their own deposit back.
            for p in participants.iter() {
                Promise::new(p.account)
                    .transfer(NearToken::from_yoctonear(session.deposit.0))
                    .detach();
            }
        } else {
            let share = pool / attendees as u128;
            let remainder = pool % attendees as u128;
            for p in participants.iter() {
                if p.checked_in {
                    Promise::new(p.account)
                        .transfer(NearToken::from_yoctonear(share))
                        .detach();
                }
            }
            // Remainder (dust) goes to the host.
            if remainder > 0 {
                Promise::new(session.host.clone())
                    .transfer(NearToken::from_yoctonear(remainder))
                    .detach();
            }
        }
    }

    // ---------------- View methods ----------------

    pub fn get_session(&self, session_id: u64) -> Session {
        self.sessions.get(&session_id).expect("Session not found")
    }

    pub fn get_participants(&self, session_id: u64) -> Vec<Participant> {
        self.participants
            .get(&session_id)
            .expect("Participants not found")
            .iter()
            .collect()
    }

    pub fn has_joined(&self, session_id: u64, account: AccountId) -> bool {
        self.participants
            .get(&session_id)
            .map(|p| p.iter().any(|x| x.account == account))
            .unwrap_or(false)
    }

    pub fn has_checked_in(&self, session_id: u64, account: AccountId) -> bool {
        self.participants
            .get(&session_id)
            .and_then(|p| p.iter().find(|x| x.account == account))
            .map(|x| x.checked_in)
            .unwrap_or(false)
    }

    pub fn next_session_id(&self) -> u64 {
        self.next_session_id
    }

    pub fn get_contract_balance(&self) -> U128 {
        U128(env::account_balance().as_yoctonear())
    }
}

/// Hash a check-in code with sha256 and return lowercase hex. Used by the host
/// when creating a session, and by tests to build the expected hash.
pub fn hash_code(code: &str) -> String {
    hex_encode(&env::sha256(code.as_bytes()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::{accounts, VMContextBuilder};
    use near_sdk::{testing_env, NearToken};

    /// 1 NEAR in yoctoNEAR.
    const DEPOSIT: u128 = 1_000_000_000_000_000_000_000_000;

    fn ctx(predecessor: AccountId, timestamp: u64, deposit: u128) -> VMContextBuilder {
        let mut b = VMContextBuilder::new();
        b.current_account_id(accounts(0))
            .signer_account_id(predecessor.clone())
            .predecessor_account_id(predecessor)
            .block_timestamp(timestamp)
            .attached_deposit(NearToken::from_yoctonear(deposit));
        b
    }

    fn create(
        contract: &mut Contract,
        host: AccountId,
        deposit: u128,
        start: u64,
        end: u64,
        code: &str,
    ) -> u64 {
        testing_env!(ctx(host, 0, 0).build());
        let hash = hash_code(code);
        contract.create_session(
            "Study Session".to_string(),
            U128(deposit),
            U64(start),
            U64(end),
            hash,
        )
    }

    fn join(contract: &mut Contract, session_id: u64, account: AccountId, deposit: u128) {
        testing_env!(ctx(account, 500, deposit).build());
        contract.join(session_id);
    }

    fn check_in(contract: &mut Contract, session_id: u64, account: AccountId, code: &str) {
        testing_env!(ctx(account, 1500, 0).build());
        contract.check_in(session_id, code.to_string());
    }

    fn settle(contract: &mut Contract, session_id: u64, account: AccountId) {
        testing_env!(ctx(account, 2500, 0).build());
        contract.settle(session_id);
    }

    #[test]
    fn test_create_session() {
        let mut contract = Contract::init();
        let id = create(&mut contract, accounts(1), DEPOSIT, 1000, 2000, "secret");
        assert_eq!(id, 1);
        let session = contract.get_session(id);
        assert_eq!(session.title, "Study Session");
        assert_eq!(session.host, accounts(1));
        assert!(!session.settled);
        assert_eq!(session.deposit.0, DEPOSIT);
        assert_eq!(contract.next_session_id(), 2);
    }

    #[test]
    fn test_join_and_check_in() {
        let mut contract = Contract::init();
        let id = create(&mut contract, accounts(1), DEPOSIT, 1000, 2000, "secret");
        join(&mut contract, id, accounts(2), DEPOSIT);
        assert!(contract.has_joined(id, accounts(2)));
        assert!(!contract.has_checked_in(id, accounts(2)));
        check_in(&mut contract, id, accounts(2), "secret");
        assert!(contract.has_checked_in(id, accounts(2)));
    }

    #[test]
    fn test_some_attendees_plus_no_shows() {
        let mut contract = Contract::init();
        let id = create(&mut contract, accounts(1), DEPOSIT, 1000, 2000, "secret");
        join(&mut contract, id, accounts(2), DEPOSIT);
        join(&mut contract, id, accounts(3), DEPOSIT);
        join(&mut contract, id, accounts(4), DEPOSIT);
        check_in(&mut contract, id, accounts(2), "secret");
        check_in(&mut contract, id, accounts(3), "secret");
        // accounts(4) never checks in.
        settle(&mut contract, id, accounts(1));
        let session = contract.get_session(id);
        assert!(session.settled);
        assert!(contract.has_checked_in(id, accounts(2)));
        assert!(contract.has_checked_in(id, accounts(3)));
        assert!(!contract.has_checked_in(id, accounts(4)));
    }

    #[test]
    fn test_everyone_attends() {
        let mut contract = Contract::init();
        let id = create(&mut contract, accounts(1), DEPOSIT, 1000, 2000, "secret");
        join(&mut contract, id, accounts(2), DEPOSIT);
        join(&mut contract, id, accounts(3), DEPOSIT);
        check_in(&mut contract, id, accounts(2), "secret");
        check_in(&mut contract, id, accounts(3), "secret");
        settle(&mut contract, id, accounts(1));
        assert!(contract.has_checked_in(id, accounts(2)));
        assert!(contract.has_checked_in(id, accounts(3)));
        assert!(contract.get_session(id).settled);
    }

    #[test]
    fn test_nobody_attends() {
        let mut contract = Contract::init();
        let id = create(&mut contract, accounts(1), DEPOSIT, 1000, 2000, "secret");
        join(&mut contract, id, accounts(2), DEPOSIT);
        join(&mut contract, id, accounts(3), DEPOSIT);
        settle(&mut contract, id, accounts(1));
        assert!(!contract.has_checked_in(id, accounts(2)));
        assert!(!contract.has_checked_in(id, accounts(3)));
        assert!(contract.get_session(id).settled);
    }

    #[test]
    #[should_panic(expected = "Must attach exactly the deposit amount")]
    fn test_wrong_deposit() {
        let mut contract = Contract::init();
        let id = create(&mut contract, accounts(1), DEPOSIT, 1000, 2000, "secret");
        join(&mut contract, id, accounts(2), DEPOSIT / 2);
    }

    #[test]
    #[should_panic(expected = "Already joined")]
    fn test_duplicate_join() {
        let mut contract = Contract::init();
        let id = create(&mut contract, accounts(1), DEPOSIT, 1000, 2000, "secret");
        join(&mut contract, id, accounts(2), DEPOSIT);
        join(&mut contract, id, accounts(2), DEPOSIT);
    }

    #[test]
    #[should_panic(expected = "Wrong check-in code")]
    fn test_wrong_code() {
        let mut contract = Contract::init();
        let id = create(&mut contract, accounts(1), DEPOSIT, 1000, 2000, "secret");
        join(&mut contract, id, accounts(2), DEPOSIT);
        check_in(&mut contract, id, accounts(2), "wrong");
    }

    #[test]
    #[should_panic(expected = "Session already settled")]
    fn test_settling_twice() {
        let mut contract = Contract::init();
        let id = create(&mut contract, accounts(1), DEPOSIT, 1000, 2000, "secret");
        join(&mut contract, id, accounts(2), DEPOSIT);
        settle(&mut contract, id, accounts(1));
        settle(&mut contract, id, accounts(1));
    }

    #[test]
    #[should_panic(expected = "Session has not ended yet")]
    fn test_settling_before_end_time() {
        let mut contract = Contract::init();
        let id = create(&mut contract, accounts(1), DEPOSIT, 1000, 2000, "secret");
        join(&mut contract, id, accounts(2), DEPOSIT);
        testing_env!(ctx(accounts(1), 1500, 0).build());
        contract.settle(id);
    }

    #[test]
    fn test_remainder_dust() {
        // 3 participants, 2 attendees, deposit = 5 yoctoNEAR.
        // pool = 15, share = 7, remainder = 1 -> goes to the host.
        let mut contract = Contract::init();
        let deposit = 5u128;
        let id = create(&mut contract, accounts(1), deposit, 1000, 2000, "secret");
        join(&mut contract, id, accounts(2), deposit);
        join(&mut contract, id, accounts(3), deposit);
        join(&mut contract, id, accounts(4), deposit);
        check_in(&mut contract, id, accounts(2), "secret");
        check_in(&mut contract, id, accounts(3), "secret");
        settle(&mut contract, id, accounts(1));
        assert!(contract.get_session(id).settled);
        // Both attendees checked in; the no-show did not.
        assert!(contract.has_checked_in(id, accounts(2)));
        assert!(contract.has_checked_in(id, accounts(3)));
        assert!(!contract.has_checked_in(id, accounts(4)));
    }

    #[test]
    #[should_panic(expected = "Not a participant")]
    fn test_check_in_without_joining() {
        let mut contract = Contract::init();
        let id = create(&mut contract, accounts(1), DEPOSIT, 1000, 2000, "secret");
        check_in(&mut contract, id, accounts(2), "secret");
    }

    #[test]
    #[should_panic(expected = "Not within session time")]
    fn test_check_in_before_session_starts() {
        let mut contract = Contract::init();
        let id = create(&mut contract, accounts(1), DEPOSIT, 1000, 2000, "secret");
        join(&mut contract, id, accounts(2), DEPOSIT);
        testing_env!(ctx(accounts(2), 500, 0).build());
        contract.check_in(id, "secret".to_string());
    }
}
