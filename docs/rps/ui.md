# RPS in the browser

The table is a static page. The browser talks to the chain. There is no game server and no database for this game. Practice blackjack stays on its own API.

`VITE_*` values are public build-time config. They are not secrets. The page never embeds an Anvil private key. On chain id `31337` the Alice and Bob buttons send through `eth_sendTransaction` to Anvil's unlocked accounts. Any other chain, and the Wallet button on Anvil, uses `window.ethereum`.

The salt for a commit stays in `localStorage` in the browser that created it. The contract does not see the salt until reveal. Clearing site data for that origin means that seat cannot reveal.

## Play against a local deploy

Anvil has to be free on port `8545`.

```bash
anvil --host 127.0.0.1 --port 8545 --chain-id 31337
```

In a second terminal, from the repo root:

```bash
npm run chain:deploy
npm run chain:env
npm run rps:dev
```

Open http://127.0.0.1:5173/rps.

`chain:deploy` writes `contracts/broadcast/local.json`. `chain:env` copies the public addresses into `.env.local` (`VITE_RPS_CHAIN_ID`, `VITE_RPS_RPC_URL`, `VITE_RPS_ADDRESS`, `VITE_USDC_ADDRESS`) and leaves every other key in that file alone. `.env.local` is gitignored. The Node server does not read it. It still loads `.env` only, the same file as the rest of the app. Vite's project root is `web/`, and its env directory is the repo root, so `.env.local` is enough for the page.

Restart `npm run rps:dev` after `chain:env`. Vite reads env when it starts. `npm run rps:dev` does not need Postgres. The blackjack API is a separate process.

If the addresses are empty or the RPC has no code at the game address, the page shows the setup steps instead of the table.

Mint 1,000 test USDC from the page. That button exists only on chain id `31337`. Pick a throw, pick a stake (1, 5, 20, or 100), and open a match. The page approves the exact stake when the allowance is short, then sends the game transaction. Switch to Bob, or to a second browser with its own wallet, and join.

Two browsers can play one match because the chain is shared. Reveal still has to happen in the browser that committed, because that is where the salt is. Alice and Bob on one browser is the local demo: both salts stay on that machine on purpose.

A match that is cancelled and then claimed returns the creator to the balance they had after the faucet. A 20 USDC rock-vs-scissors win credits the winner `39.96` (the pot of 40 minus the 0.1% fee). The fee stays in the contract until the fee account calls `claim`.

| Seat | After 1,000 USDC and a won or lost 20 USDC pot |
| --- | --- |
| Winner | 1,019.96 |
| Loser | 980.00 |

The page lists the newest 30 matches, newest first. Older matches are still on the chain. A later indexer, for example a Cloudflare Worker that follows `Created`, can replace that scan. The page does not need one to play. Reads use a JSON-RPC batch of 40 calls. They do not use Multicall3, which a fresh Anvil may not have.

## Automated check

`npm run rps:check` starts Anvil on port `18545` and Vite on port `4179`, deploys, and plays the game in headless Chromium. Those ports stay off `8545` and `5173`. The script restores `contracts/broadcast/local.json` when it finishes, so the throwaway deploy does not replace the file `chain:env` last wrote.

The script mints 1,000 USDC to Alice, opens a 20 USDC match, cancels it, and claims back to `1,000.00`. Alice then opens with rock. Bob mints 1,000 and joins with scissors. Both reveal, the match settles, and Alice claims. The page shows `1,019.96` and `980.00`. `cast` reads the same balances, and the contract still holds the `40_000` unit fee. A failure writes `/tmp/rps-ui.png`.

```bash
npm run rps:check
```

The first run may need the browser binary:

```bash
npx playwright install chromium
```

## Static and serverless hosting

`npm run build` writes `dist/web`, including `rps.html`. A static host can serve that directory. Map `/rps` to `rps.html` the same way the dev server does. The blackjack API and Postgres stay behind the Node service. The RPS page does not call them.

Build the addresses into the assets. Empty addresses still build, and the RPS page shows the setup steps. Practice blackjack does not read them.

```bash
docker build \
  --build-arg VITE_RPS_CHAIN_ID=31337 \
  --build-arg VITE_RPS_RPC_URL=http://127.0.0.1:8545 \
  --build-arg VITE_RPS_ADDRESS=0xYourGame \
  --build-arg VITE_USDC_ADDRESS=0xYourToken \
  .
```

Do not deploy `MockUSDC` on a public network. `mint` is open. Do not put Anvil keys in the image or the bundle.

The Node server sets `Content-Security-Policy` on the HTML. `/` and `/admin` stay `connect-src 'self'`. `/rps` also allows `http://127.0.0.1:8545` and `http://localhost:8545`. `RPS_RPC_URL` in `.env` or the process environment adds one more origin on `/rps` when it is an `http` or `https` URL with no username. Set it to the same origin baked into `VITE_RPS_RPC_URL` when that origin is not local Anvil, or the browser will block the RPC. The container does not dial the chain. The player's browser does. Compose passes `RPS_RPC_URL` through for that header. `chain:env` updates `RPS_RPC_URL` in `.env` only when that file already exists.

Vite dev has no CSP. The browser check uses Vite for that reason. A static host must set its own `connect-src`. One Cloudflare Pages `_headers` file:

```
/*
  Content-Security-Policy: default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; connect-src 'self' https://your-rpc.example; base-uri 'none'; frame-ancestors 'none'
```

Add the local Anvil origins to that line when the static host is used against a chain on the developer's machine.

Changing the RPC or the contract addresses means a new build. Restarting a server is not enough, because the values are already in the assets.
