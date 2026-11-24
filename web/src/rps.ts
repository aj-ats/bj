import type { Address, PublicClient, WalletClient } from 'viem';
import './styles.css';
import './rps.css';
import {
  cancelMatch,
  claimPayout,
  createMatch,
  ensureAllowance,
  joinMatch,
  loadTable,
  makeAnvilWallet,
  makeBrowserWallet,
  makePublicClient,
  mintTestUsdc,
  revealThrow,
  settleMatch,
  timeoutMatch,
  type TableSnapshot,
} from './rps/chain.ts';
import { commitHash, randomSalt, THROW_NAME, type Throw } from './rps/commit.ts';
import {
  ANVIL_ALICE,
  ANVIL_BOB,
  ANVIL_CHAIN_ID,
  configReady,
  loadRpsConfig,
  type ReadyConfig,
} from './rps/config.ts';
import { errorText, parseWholeToken, sameAddress } from './rps/format.ts';
import { loadThrow, saveThrow, type SavedThrow } from './rps/salt.ts';
import { render, type ViewModel } from './rps/view.ts';

const rootElement = document.querySelector('#app');
if (!rootElement) throw new Error('Missing #app');
const root: Element = rootElement;

const config = loadRpsConfig();
const ready = configReady(config) ? config : null;

type Seat = ViewModel['seat'];

const state: ViewModel = {
  config,
  ready: ready !== null,
  loading: true,
  demoSeats: config.chainId === ANVIL_CHAIN_ID,
  seat: config.chainId === ANVIL_CHAIN_ID ? 'alice' : 'wallet',
  account: config.chainId === ANVIL_CHAIN_ID ? ANVIL_ALICE : null,
  choice: null,
  stakeWhole: 20,
  selectedId: null,
  snapshot: null,
  saved: null,
  error: null,
  notice: null,
  busy: false,
};

let publicClient: PublicClient | null = null;
let wallet: WalletClient | null = null;
let generation = 0;
let stickyError = false;

function paint(): void {
  root.innerHTML = render(state);
}

root.addEventListener('click', (event) => {
  const button = (event.target as Element | null)?.closest('button');
  if (!(button instanceof HTMLButtonElement) || button.disabled || state.busy) return;
  const seat = button.dataset.seat;
  const choice = button.dataset.choice;
  const stake = button.dataset.stake;
  const match = button.dataset.match;
  const action = button.dataset.action;
  if (seat === 'alice' || seat === 'bob' || seat === 'wallet') {
    void run(() => useSeat(seat));
    return;
  }
  if (choice === '1' || choice === '2' || choice === '3') {
    state.choice = Number(choice) as Throw;
    paint();
    return;
  }
  if (stake === '1' || stake === '5' || stake === '20' || stake === '100') {
    state.stakeWhole = Number(stake);
    paint();
    return;
  }
  if (match) {
    state.selectedId = BigInt(match);
    state.saved = readSaved();
    paint();
    return;
  }
  if (action) void run(() => act(action));
});

async function boot(): Promise<void> {
  paint();
  if (!ready) return;
  publicClient = makePublicClient(ready);
  if (state.demoSeats) wallet = makeAnvilWallet(ready);
  await refresh();
  window.setInterval(() => {
    if (state.busy || document.hidden) return;
    void refresh();
  }, 4000);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && !state.busy) void refresh();
  });
}

async function refresh(): Promise<void> {
  if (!ready || !publicClient || !state.account) return;
  const gen = ++generation;
  const account = state.account;
  try {
    const snapshot = await loadTable(publicClient, ready, account);
    if (gen !== generation || state.account !== account) return;
    state.snapshot = snapshot;
    state.selectedId = preferredMatch(snapshot, account, state.selectedId);
    state.saved = readSaved();
    state.loading = false;
    if (!stickyError) state.error = null;
    paint();
  } catch (error) {
    if (gen !== generation) return;
    state.loading = false;
    state.error = errorText(error);
    stickyError = false;
    paint();
  }
}

async function run(work: () => Promise<void>): Promise<void> {
  if (state.busy) return;
  generation += 1;
  state.busy = true;
  stickyError = false;
  state.error = null;
  paint();
  let failed: string | null = null;
  try {
    await work();
  } catch (error) {
    failed = errorText(error);
  }
  state.busy = false;
  await refresh();
  if (failed) {
    stickyError = true;
    state.error = failed;
    paint();
  }
}

async function useSeat(seat: Seat): Promise<void> {
  state.choice = null;
  state.seat = seat;
  if (seat === 'alice') {
    state.account = ANVIL_ALICE;
    if (ready) wallet = makeAnvilWallet(ready);
    return;
  }
  if (seat === 'bob') {
    state.account = ANVIL_BOB;
    if (ready) wallet = makeAnvilWallet(ready);
    return;
  }
  await connectWallet();
}

async function connectWallet(): Promise<void> {
  if (!ready) return;
  const provider = window.ethereum;
  if (!provider) throw new Error('No browser wallet is available.');
  wallet = makeBrowserWallet(ready, provider);
  const accounts = (await provider.request({ method: 'eth_requestAccounts' })) as readonly string[];
  const account = accounts[0];
  if (!account) throw new Error('The wallet returned no account.');
  await ensureChain(provider);
  state.account = account as Address;
  state.seat = 'wallet';
  state.choice = null;
}

async function ensureChain(provider: EthereumProvider): Promise<void> {
  if (!ready) return;
  const chainId = `0x${ready.chainId.toString(16)}`;
  try {
    await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId }] });
  } catch (error) {
    if (errorCode(error) !== 4902) throw error;
    await provider.request({
      method: 'wallet_addEthereumChain',
      params: [
        {
          chainId,
          chainName: ready.chainId === ANVIL_CHAIN_ID ? 'Anvil' : `Chain ${ready.chainId}`,
          nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
          rpcUrls: [ready.rpcUrl],
        },
      ],
    });
  }
}

async function act(action: string): Promise<void> {
  if (state.seat === 'wallet' && window.ethereum) await ensureChain(window.ethereum);
  if (action === 'faucet') return faucet();
  if (action === 'create') return create();
  if (action === 'join') return join();
  if (action === 'cancel') return cancel();
  if (action === 'reveal') return reveal();
  if (action === 'settle') return settle();
  if (action === 'timeout') return timeout();
  if (action === 'claim') return claim();
}

async function faucet(): Promise<void> {
  const seat = session();
  const amount = parseWholeToken(1000, seat.snapshot.decimals);
  await mintTestUsdc(seat.publicClient, seat.wallet, seat.config, seat.account, amount);
  state.notice = 'Minted 1,000 test USDC.';
}

async function create(): Promise<void> {
  const seat = session();
  if (state.choice === null) throw new Error('Pick rock, paper, or scissors first.');
  const salt = randomSalt();
  const commit = commitHash(state.choice, salt);
  const stake = parseWholeToken(state.stakeWhole, seat.snapshot.decimals);
  await ensureAllowance(seat.publicClient, seat.wallet, seat.config, seat.account, stake);
  const id = await createMatch(seat.publicClient, seat.wallet, seat.config, seat.account, commit, stake);
  saveThrow(key(seat.config, seat.account, id), { choice: state.choice, salt });
  state.selectedId = id;
  state.choice = null;
  state.notice = `Match ${id.toString()} is open. The salt for this seat is in this browser.`;
}

async function join(): Promise<void> {
  const seat = session();
  const match = selected(seat.snapshot);
  if (state.choice === null) throw new Error('Pick rock, paper, or scissors first.');
  const salt = randomSalt();
  const commit = commitHash(state.choice, salt);
  await ensureAllowance(seat.publicClient, seat.wallet, seat.config, seat.account, match.stake);
  await joinMatch(seat.publicClient, seat.wallet, seat.config, seat.account, match.id, commit);
  saveThrow(key(seat.config, seat.account, match.id), { choice: state.choice, salt });
  state.choice = null;
  state.notice = `Joined match ${match.id.toString()}. Reveal from this browser.`;
}

async function reveal(): Promise<void> {
  const seat = session();
  const match = selected(seat.snapshot);
  const saved = loadThrow(key(seat.config, seat.account, match.id));
  if (!saved) {
    throw new Error('This browser does not have the salt for this seat. Site data may have been cleared.');
  }
  await revealThrow(seat.publicClient, seat.wallet, seat.config, seat.account, match.id, saved.choice, saved.salt);
  state.notice = `Revealed ${THROW_NAME[saved.choice]}.`;
}

async function cancel(): Promise<void> {
  const seat = session();
  const match = selected(seat.snapshot);
  await cancelMatch(seat.publicClient, seat.wallet, seat.config, seat.account, match.id);
  state.notice = `Match ${match.id.toString()} is cancelled. Claim the stake.`;
}

async function settle(): Promise<void> {
  const seat = session();
  const match = selected(seat.snapshot);
  await settleMatch(seat.publicClient, seat.wallet, seat.config, seat.account, match.id);
  state.notice = `Match ${match.id.toString()} is settled. Claim the payout.`;
}

async function timeout(): Promise<void> {
  const seat = session();
  const match = selected(seat.snapshot);
  await timeoutMatch(seat.publicClient, seat.wallet, seat.config, seat.account, match.id);
  state.notice = `Match ${match.id.toString()} timed out. Claim what the contract credited.`;
}

async function claim(): Promise<void> {
  const seat = session();
  await claimPayout(seat.publicClient, seat.wallet, seat.config, seat.account);
  state.notice = 'Claimed.';
}

function session(): {
  publicClient: PublicClient;
  wallet: WalletClient;
  config: ReadyConfig;
  account: Address;
  snapshot: TableSnapshot;
} {
  if (!ready || !publicClient || !wallet || !state.account || !state.snapshot) {
    throw new Error('Connect a seat before sending a transaction.');
  }
  return {
    publicClient,
    wallet,
    config: ready,
    account: state.account,
    snapshot: state.snapshot,
  };
}

function selected(snapshot: TableSnapshot) {
  const match = snapshot.matches.find((item) => item.id === state.selectedId);
  if (!match) throw new Error('Pick a match first.');
  return match;
}

function preferredMatch(snapshot: TableSnapshot, account: Address, current: bigint | null): bigint | null {
  if (current !== null && snapshot.matches.some((match) => match.id === current)) return current;
  const own = snapshot.matches.find(
    (match) => sameAddress(match.p1, account) || sameAddress(match.p2, account),
  );
  return own?.id ?? snapshot.matches[0]?.id ?? null;
}

function readSaved(): SavedThrow | null {
  if (!ready || !state.account || state.selectedId === null) return null;
  return loadThrow(key(ready, state.account, state.selectedId));
}

function key(game: ReadyConfig, player: Address, matchId: bigint) {
  return { chainId: game.chainId, rps: game.rps, player, matchId };
}

function errorCode(error: unknown): number | null {
  if (typeof error !== 'object' || error === null || !('code' in error)) return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'number' ? code : null;
}

void boot();
