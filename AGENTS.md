# Working in this repo

Extend the app that is here. Do not add a service, a framework, or a second way to do something this repo already does.

## Layout

- Practice blackjack lives in `src/` and `web/src/main.ts`. Chips are fake. Leave the rules, the starting stack, and the existing `data-testid`s alone unless the task changes them.
- The house console is `web/src/admin.ts`, served at `/admin`.
- Rock-paper-scissors is the Foundry project in `contracts/` and the page in `web/src/rps.ts`. Rules and the browser runbook are in `docs/rps/`. The page is static. It does not use Postgres or the blackjack API.
- `docs/pvp/` is a heads-up blackjack spec. It is not built. Do not start it as a side effect of other work.

A new browser page is an HTML file in `web/`, a script in `web/src/`, and a route in `src/app.ts` beside `/` and `/admin`. `web/tsconfig.json` typechecks the pages. The root `tsconfig.json` typechecks the server and stays free of DOM types.

## Change discipline

- Read the code around the edit and match it. Keep the diff to the task. Do not rename, reformat, or restructure unrelated files.
- Fix the cause. Do not wrap a bug with a fallback that hides it.
- `src/game/` is plain TypeScript with no Node imports. Leave it that way.
- Server config is environment variables in `src/config.ts`. The process loads `.env` and does not load `.env.local`. Vite reads `VITE_*` from the repo root. `VITE_*` values are public and are compiled into the page. Never put a secret or a private key in one.
- `viem` stays a devDependency. The RPS page bundles it. Production `npm ci --omit=dev` does not install it.
- Anvil's published keys in `scripts/rps/` are for chain id `31337` only. Do not copy them into `web/`. Do not deploy `MockUSDC`. `mint` is open.
- Do not widen the CSP on `/` or `/admin`. An RPC origin belongs on `/rps` only.
- Do not write RPS results onto the fake-chip leaderboard.

## Checks

- `npm run typecheck` for the server and the pages.
- `npm test` for blackjack. The suite starts Postgres through a testcontainer, so it needs Docker. Do not add a chain or browser test to that run.
- `npm run chain:test` for the contracts. `npm run chain:e2e` plays the game on Anvil port `8545`. That port has to be free. The shell checks and the `cast` commands are in `docs/rps/foundry.md`. A revert check has to match the custom error. A command that merely fails is not a pass.
- `npm run rps:check` plays the page against a throwaway Anvil on port `18545` and Vite on port `4179`. It does not need Postgres. It restores `contracts/broadcast/local.json`.
- Say which of these you did not run.

## Git

- Do not commit `.env`, `.env.local`, `dist/`, `node_modules/`, or `contracts/broadcast/`.
- Do not push unless asked.
- The subject line says what changed. The body says why.
