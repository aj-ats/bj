# Test the contracts from the shell

Three checks cover the game. They stay separate on purpose.

| Check | What it proves | Command |
| --- | --- | --- |
| Forge unit tests | The Solidity, including cheatcodes such as `vm.prank` and `vm.expectRevert` | `npm run chain:test` |
| Bash scripts | The same calls a wallet makes, against a real Anvil node | `npm run chain:e2e` |
| Browser | The page, the salt in `localStorage`, and the balances | `npm run rps:check` |

`npm test` is the blackjack suite. It starts Postgres. Do not put a chain script in that run.

`cast` is the fast way to talk to a contract. One process, no app build. The TypeScript client is the page in `web/src/rps/chain.ts`. It uses viem. Use `cast` while you are poking at a function. Use the page when you need the commit salt to stay in a browser.

## Run a chain

Port `8545` has to be free. `chain:e2e` uses it. The browser check uses `18545` so the two can run without sharing a chain.

```bash
anvil --host 127.0.0.1 --port 8545 --chain-id 31337
```

Bind `127.0.0.1`. Anvil unlocks its accounts for anyone who can reach the port. Do not pass `--host 0.0.0.0`.

In another terminal, one script, or the whole set:

```bash
bash scripts/rps/02-lobby.sh
npm run chain:e2e
```

`chain:e2e` is `scripts/rps-local.sh`. It refuses to start when `8545` is taken, runs `forge test`, starts Anvil, waits until `cast chain-id` answers, then runs `01-token.sh` through `05-pause.sh` and `deploy.sh`. `trap cleanup EXIT` kills Anvil on success and on failure. The log is `/tmp/rps-anvil-e2e.log`.

Each numbered script deploys a fresh `MockUSDC` and `Rps`. They do not share matches. `deploy.sh` is the one that writes `contracts/broadcast/local.json`.

Foundry lives in `contracts/`. From the repo root, pass `--root contracts`. `forge script` is happier when you `cd contracts` first. `deploy.sh` does that.

## How a script is put together

Every script starts with the same three lines.

```bash
set -euo pipefail
source "$(cd "$(dirname "$0")" && pwd)/common.sh"
require_anvil
```

`set -e` stops the script on a failed command. `set -u` stops it on an unset variable, which is how a typo in `$RPS` dies instead of sending a transaction to an empty address. `set -o pipefail` makes a pipeline fail when `cast` fails. Without it, `cast call ... | sed` can turn a dead RPC into an empty string, and an empty string can satisfy the wrong assertion.

`set -e` does not fire when the failing command is the condition of an `if`. `expect_revert` depends on that. The `cast send` inside it is allowed to fail. The helper then checks why.

`require_anvil` reads `eth_chainId`. It exits if the RPC is down or the id is not `31337`. That is the guard that keeps these keys off a public chain. Do not delete it. Do not point `RPC` at anything but a local Anvil.

The keys in `scripts/rps/common.sh` are Anvil's published defaults. Account 0 is the owner. Account 1 plays as Bob. Account 2 receives the fee. Addresses:

| Seat | Address |
| --- | --- |
| Alice, owner | `0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266` |
| Bob | `0x70997970C51812dc3A010C7d01b50e0d17dc79C8` |
| Fee | `0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC` |

`deploy` runs `forge create --json` and prints only the new address. A failed compile or a refused RPC prints `FAIL deploy` and the forge output.

`send_ok` runs `cast send --json` and requires receipt status `0x1`. A revert prints `FAIL send` and the cast error. The private key is not part of that message.

`call_uint` reads a view. Cast prints values like `75000000[7.5e7]`. The helper keeps the integer and drops the bracket. An empty reply is a failure.

`assert_eq` prints `ok` or exits with the value it got and the value it wanted.

`expect_revert` takes a label, a custom-error signature, and the command:

```bash
expect_revert "blank commit" "BadCommit()" \
  cast send --rpc-url "$RPC" --private-key "$ALICE_KEY" "$RPS" \
  "createMatch(bytes32,uint256)" "$ZERO" "$STAKE"
```

The command must fail, and the failure text must contain the selector from `cast sig "BadCommit()"`. A down RPC, a wrong argument count, or a revert of `BadStake()` does not pass this check. Matching "the command failed" is not a test. That is how a broken script hides a broken contract.

`02-lobby.sh` is the short tour. It deploys, mints 100 USDC (`100000000` units) to Alice and Bob, and approves the game. It then expects `BadCommit` for an empty commit and `BadStake` for `999999` units. Alice creates a 20 USDC lobby, Bob is rejected with `NotPlayer` when he tries to cancel it, Alice cancels and claims, and a second `claim` reverts with `NothingToClaim`. The next match is joined by Bob. Cancelling or joining again reverts with `BadStatus`. The last match warps the clock and then expects `Expired`.

The warp is Anvil only:

```bash
cast rpc --rpc-url "$RPC" evm_increaseTime 601
cast rpc --rpc-url "$RPC" evm_mine
```

`601` is one second past the 10 minute window. Those RPC methods do nothing useful on a public chain, and a test that needs them is not a production path.

`03-settle.sh` reveals. The commit is `commitHash(choice, salt)` on the contract, which is `keccak256(abi.encode(uint8, bytes32))`. The script asks the contract for the hash so the test cannot drift from the Solidity. A reveal with the other seat's salt must revert `BadReveal`. `settle` before both reveals must revert `BadStatus`.

`04-timeout.sh` shows `TooEarly`, then a one-sided reveal, then a double silence. `05-pause.sh` shows `NotOwner` and `GameIsPaused`. Pause does not block cancel, reveal, settle, or claim.

## Commands

Set the RPC once per terminal.

```bash
export RPC=http://127.0.0.1:8545
cast chain-id --rpc-url "$RPC"
```

After `npm run chain:deploy`, the addresses are in `contracts/broadcast/local.json`.

```bash
USDC=$(python3 -c 'import json; print(json.load(open("contracts/broadcast/local.json"))["usdc"])')
RPS=$(python3 -c 'import json; print(json.load(open("contracts/broadcast/local.json"))["rps"])')
```

Read. These do not send a transaction.

```bash
cast call --rpc-url "$RPC" "$USDC" "balanceOf(address)(uint256)" 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
cast call --rpc-url "$RPC" "$RPS" "nextMatchId()(uint256)"
cast call --rpc-url "$RPC" "$RPS" "paused()(bool)"
cast call --rpc-url "$RPC" "$RPS" "matchStatus(uint256)(uint8)" 1
cast call --rpc-url "$RPC" "$RPS" \
  "matches(uint256)(address,address,uint256,bytes32,bytes32,uint8,uint8,uint64,uint64,uint8)" 1
cast logs --rpc-url "$RPC" --from-block 0 --address "$RPS" "Created(uint256,address,uint256,bytes32)"
```

The `(type)` at the end of a signature tells `cast call` to decode the return. Leave it off on `cast send`.

Write. This signs with Anvil account 0. The mint amount is 100 USDC, 6 decimals.

```bash
cast send --rpc-url "$RPC" \
  --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 \
  "$USDC" "mint(address,uint256)" 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266 100000000
```

When a send reverts, copy the selector out of the error and decode it.

```bash
cast sig "BadReveal()"
cast 4byte 0x02dbead2
```

`cast 4byte` prints `BadCommit()` for `0x02dbead2`. Then rerun the failing transaction hash:

```bash
cast run --rpc-url "$RPC" "$TX"
cast receipt --rpc-url "$RPC" "$TX"
```

Forge traces stay in the unit tests. `-vvv` prints the call trace. `-vvvv` adds the storage.

```bash
forge test --root contracts --match-contract RpsSettle -vvv
forge test --root contracts --match-test reveal -vvvv
```

## TypeScript

A one-off read does not need the page. `viem` is already a devDependency. This file is not part of the app. Save it outside the repo and point it at your Anvil.

```ts
import { createPublicClient, http, parseAbi } from 'viem';

const client = createPublicClient({ transport: http('http://127.0.0.1:8545') });
const rps = process.env.RPS as `0x${string}`;
const nextMatchId = await client.readContract({
  address: rps,
  abi: parseAbi(['function nextMatchId() view returns (uint256)']),
  functionName: 'nextMatchId',
});
console.log(nextMatchId.toString());
```

```bash
RPS=0xYourGame npx tsx /tmp/read-rps.ts
```

Do not put a private key in that file. A local write belongs in `cast send` or in the bash scripts. The browser signs with `eth_sendTransaction` against Anvil's unlocked accounts, or with `window.ethereum`. It never sees the keys from `common.sh`.

The page's send path is `send()` in `web/src/rps/chain.ts`. It encodes the call, sends it, waits for the receipt, and rejects a status other than success. Revert text for the UI is `errorText()` in `web/src/rps/format.ts`.

## What will hurt you

- `MockUSDC.mint` is public. Deploying that token on a public network lets anyone mint. The bash guard is the chain id. It is not a substitute for keeping the token off a public RPC.
- `--private-key` lands in the process list and in shell history. That is acceptable for Anvil's published key. It is not acceptable for a key that holds real funds. Do not export a funded key as `PRIVATE_KEY` and then run `deploy.sh`.
- Removing `require_anvil`, or setting `RPC` to a public endpoint, aims those same keys at a network where they might have been reused. People do reuse them.
- Anvil's unlocked accounts accept `eth_sendTransaction` from anyone who can hit the RPC. The page's Alice and Bob buttons work because of that. A laptop running `anvil --host 0.0.0.0` is a public wallet.
- A fixed salt and a 3-value choice can be guessed. The scripts use fixed salts so the assert is stable. A player needs 32 random bytes, stored until reveal, in the browser that committed. The contract does not keep the salt.
- `MockUSDC` checks the allowance before the balance. A revert you read as "no tokens" is often "no approval". Approve the stake, then create or join.
- `claim` sets the credit to zero before it transfers. A token that calls back in `transfer` hits `Reentrancy` and does not get a second credit. Do not "fix" a failed claim by transferring first.
- The owner can pause and unpause. Pause blocks `createMatch` and `joinMatch` only. There is no admin withdraw. Do not add one.
- `evm_increaseTime` and `vm.warp` are cheats. A timeout test that never warps the clock has not reached `timeout`.
- In Forge tests, `vm.expectRevert` and `vm.prank` are consumed by the next external call, including a call you only meant as an argument. Read the value into a local, then set the cheat, then make the call you mean to check. `cast` scripts do not have this trap. Forge tests do.
- `cast call` on a revert still exits non-zero. With `pipefail`, the script stops. Without it, you assert against an empty string and the failure looks like a wrong balance.
- Two chains are easy to mix up. `8545` is the interactive Anvil and `chain:e2e`. `18545` is the browser check. `RPC` chooses. A script that "passes" against the wrong chain is testing leftover state.
- `forge script` from the repo root, with `--root contracts`, has failed here with a path error. Run it from `contracts/`, which is what `deploy.sh` does.

## When a script fails

The failing line is the last `FAIL` or the last `ok` you did not see. `expect_revert` prints the cast error under the selector it wanted. `assert_eq` prints `got` and `expected`.

Fix the contract or the call. Do not loosen `expect_revert` so that any failure counts. Then run the one script against the Anvil you already have, and run `npm run chain:e2e` before you call the change done.
