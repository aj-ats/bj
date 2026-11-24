import type { Address } from 'viem';
import { ANVIL_CHAIN_ID, LOOKBACK, type RpsConfig } from './config.ts';
import { beats, THROW_NAME, type Throw } from './commit.ts';
import type { OnchainMatch, TableSnapshot } from './chain.ts';
import type { SavedThrow } from './salt.ts';
import {
  clockLeft,
  escapeHtml,
  formatToken,
  isZeroAddress,
  sameAddress,
  shortAddress,
  statusName,
} from './format.ts';

export interface ViewModel {
  config: RpsConfig;
  ready: boolean;
  loading: boolean;
  demoSeats: boolean;
  seat: 'alice' | 'bob' | 'wallet';
  account: Address | null;
  choice: Throw | null;
  stakeWhole: number;
  selectedId: bigint | null;
  snapshot: TableSnapshot | null;
  saved: SavedThrow | null;
  error: string | null;
  notice: string | null;
  busy: boolean;
}

const STAKES = [1, 5, 20, 100];

export function render(model: ViewModel): string {
  if (!model.ready) return setup(model);
  if (!model.account) {
    return shell(model, '<p class="note">Choose Wallet and connect to read the table.</p>', false);
  }
  const table = model.snapshot;
  if (!table) {
    return shell(model, '<p class="note">Reading the chain…</p>', false);
  }
  const selected = table.matches.find((match) => match.id === model.selectedId) ?? null;
  return shell(
    model,
    `<div class="layout">
      <section class="felt rps-felt">
        ${pausedNote(table)}
        <div>
          <h2>Your throw</h2>
          <div class="throws" role="group" aria-label="Throw">
            ${throwButton(1, model)}
            ${throwButton(2, model)}
            ${throwButton(3, model)}
          </div>
        </div>
        <div>
          <h2>Stake</h2>
          <div class="stakes">
            ${STAKES.map((stake) => stakeButton(stake, model)).join('')}
          </div>
        </div>
        <div class="rps-actions">
          ${model.demoSeats ? `<button class="ghost" type="button" data-action="faucet" data-testid="faucet" ${disabled(model.busy)}>Mint 1,000 test USDC</button>` : ''}
          <button class="deal" type="button" data-action="create" data-testid="create" ${disabled(model.busy || model.choice === null || table.paused)}>Open match</button>
        </div>
        ${matchPanel(model, table, selected)}
      </section>
      <aside class="board rps-board">
        <h2>Latest matches</h2>
        <p class="fine">The newest ${LOOKBACK}. The chain still holds every match.</p>
        <div class="match-list" data-testid="matches">
          ${table.matches.length === 0 ? '<p class="fine">No matches yet.</p>' : table.matches.map((match) => matchRow(match, model, table)).join('')}
        </div>
      </aside>
    </div>`,
    true,
  );
}

function shell(model: ViewModel, body: string, loaded: boolean): string {
  const table = model.snapshot;
  const balance = table && model.account ? formatToken(table.usdc, table.decimals) : '—';
  const chain = table ? `${chainName(table.chainId)} · ${table.chainId}` : chainName(model.config.chainId);
  const marker = loaded ? 'data-testid="ready"' : 'data-testid="loading"';
  return `<main class="app rps-app" ${marker}>
    <header class="top">
      <div class="brand">
        <h1>RPS</h1>
        <p>Commit, then reveal. The contract holds the stake.</p>
        <p class="fine"><a href="/">Practice blackjack</a></p>
      </div>
      <div class="stack">
        <p data-testid="chain">${escapeHtml(chain)}</p>
        <p>USDC</p>
        <strong data-testid="usdc-balance">${escapeHtml(balance)}</strong>
        <p class="fine" data-testid="seat-address">${model.account ? escapeHtml(shortAddress(model.account)) : 'No seat'}</p>
        <div class="seat-row">
          ${model.demoSeats ? seatButton('alice', 'Alice', model) : ''}
          ${model.demoSeats ? seatButton('bob', 'Bob', model) : ''}
          ${seatButton('wallet', 'Wallet', model)}
        </div>
      </div>
    </header>
    <p class="alert" data-testid="error">${escapeHtml(model.error ?? '')}</p>
    <p class="note" data-testid="notice">${escapeHtml(model.notice ?? '')}</p>
    ${body}
    <p class="fine rps-foot">The salt stays in this browser. Clearing site data means that seat cannot reveal. Payouts move when you claim.</p>
  </main>`;
}

function setup(model: ViewModel): string {
  const problem = problemText(model);
  return `<main class="app rps-app" data-testid="setup">
    <header class="top">
      <div class="brand">
        <h1>RPS</h1>
        <p>The page needs the contract addresses from a local deploy.</p>
        <p class="fine"><a href="/">Practice blackjack</a></p>
      </div>
    </header>
    <section class="felt rps-felt">
      <p class="alert" data-testid="error">${escapeHtml(problem)}</p>
      <ol class="setup-steps">
        <li><code>anvil --host 127.0.0.1 --port 8545 --chain-id 31337</code></li>
        <li><code>npm run chain:deploy</code></li>
        <li><code>npm run chain:env</code></li>
        <li>Restart <code>npm run rps:dev</code> and open <code>/rps</code>.</li>
      </ol>
      <p class="fine">RPC ${escapeHtml(model.config.rpcUrl)}. Chain ${model.config.chainId}.</p>
    </section>
  </main>`;
}

export function problemText(model: ViewModel): string {
  if (model.config.problem) return model.config.problem;
  if (!model.config.rps || !model.config.usdc) {
    return 'Contract addresses are not set. Deploy to Anvil and sync them into .env.local.';
  }
  return model.error ?? 'The chain is not ready.';
}

function throwButton(choice: Throw, model: ViewModel): string {
  const pressed = model.choice === choice;
  return `<button class="throw" type="button" data-choice="${choice}" data-testid="throw-${choice}" aria-pressed="${pressed}" ${disabled(model.busy)}>
    <span>${THROW_NAME[choice]}</span>
  </button>`;
}

function stakeButton(stake: number, model: ViewModel): string {
  const pressed = model.stakeWhole === stake;
  return `<button class="ghost stake" type="button" data-stake="${stake}" data-testid="stake-${stake}" aria-pressed="${pressed}" ${disabled(model.busy)}>${stake}</button>`;
}

function seatButton(seat: ViewModel['seat'], label: string, model: ViewModel): string {
  const pressed = model.seat === seat;
  return `<button class="ghost" type="button" data-seat="${seat}" data-testid="seat-${seat}" aria-pressed="${pressed}" ${disabled(model.busy)}>${label}</button>`;
}

function pausedNote(table: TableSnapshot): string {
  if (!table.paused) return '';
  return '<p class="note">New matches are paused. Matches already open can still finish.</p>';
}

function matchPanel(model: ViewModel, table: TableSnapshot, match: OnchainMatch | null): string {
  if (!match || !model.account) {
    return '<div class="match-panel"><p class="fine">Open a match, or pick one from the list.</p></div>';
  }
  const me = model.account;
  const seat = seatOf(match, me);
  const yourChoice = seat === 1 ? match.choice1 : seat === 2 ? match.choice2 : 0;
  const theirChoice = seat === 1 ? match.choice2 : seat === 2 ? match.choice1 : 0;
  const committed = model.saved ? THROW_NAME[model.saved.choice] : '';
  const joinCloses = match.createdAt + table.joinWindow;
  const revealCloses = match.revealDeadline;
  const canJoin = match.status === 1 && seat === 0 && table.blockTime <= joinCloses && !table.paused;
  const canCancel = match.status === 1 && (seat === 1 || table.blockTime > joinCloses);
  const canReveal = match.status === 2 && seat !== 0 && yourChoice === 0 && model.saved !== null;
  const missingSalt = match.status === 2 && seat !== 0 && yourChoice === 0 && model.saved === null;
  const canSettle = match.status === 2 && match.choice1 !== 0 && match.choice2 !== 0;
  const canTimeout = match.status === 2 && table.blockTime > revealCloses;
  const clock = match.status === 1
    ? clockLeft(joinCloses, table.blockTime)
    : match.status === 2
      ? clockLeft(revealCloses, table.blockTime)
      : '';
  return `<div class="match-panel">
    <h2>Match <span data-testid="match-id">${match.id.toString()}</span></h2>
    <p data-testid="match-status">${escapeHtml(statusName(match.status))}</p>
    <p class="fine">${escapeHtml(formatToken(match.stake, table.decimals))} USDC each · ${escapeHtml(clock)}</p>
    <p>Seat 1 ${escapeHtml(playerLabel(match.p1, me))}</p>
    <p>Seat 2 ${escapeHtml(isZeroAddress(match.p2) ? 'Open' : playerLabel(match.p2, me))}</p>
    <p data-testid="your-throw">You ${escapeHtml(throwLabel(yourChoice, committed))}</p>
    <p data-testid="their-throw">Opponent ${escapeHtml(theirLabel(match, seat, theirChoice))}</p>
    <p class="fine">${escapeHtml(resultLine(match, me))}</p>
    ${missingSalt ? '<p class="alert">This browser does not have the salt for this seat. Reveal has to happen in the browser that committed.</p>' : ''}
    <div class="rps-actions">
      ${canJoin ? `<button class="deal" type="button" data-action="join" data-testid="join" ${disabled(model.busy || model.choice === null)}>Join match</button>` : ''}
      ${canCancel ? `<button class="ghost" type="button" data-action="cancel" data-testid="cancel" ${disabled(model.busy)}>Cancel</button>` : ''}
      ${canReveal ? `<button class="deal" type="button" data-action="reveal" data-testid="reveal" ${disabled(model.busy)}>Reveal</button>` : ''}
      ${canSettle ? `<button class="deal" type="button" data-action="settle" data-testid="settle" ${disabled(model.busy)}>Settle</button>` : ''}
      ${canTimeout ? `<button class="ghost" type="button" data-action="timeout" data-testid="timeout" ${disabled(model.busy)}>Timeout</button>` : ''}
      ${table.claimable > 0n ? `<button class="ghost" type="button" data-action="claim" data-testid="claim" ${disabled(model.busy)}>Claim ${escapeHtml(formatToken(table.claimable, table.decimals))}</button>` : ''}
    </div>
  </div>`;
}

function matchRow(match: OnchainMatch, model: ViewModel, table: TableSnapshot): string {
  const selected = match.id === model.selectedId ? ' selected' : '';
  const opponent = isZeroAddress(match.p2) ? 'open' : shortAddress(match.p2);
  return `<button class="match-row${selected}" type="button" data-match="${match.id.toString()}" data-testid="match-${match.id.toString()}">
    <strong>#${match.id.toString()} ${escapeHtml(statusName(match.status))}</strong>
    <span>${escapeHtml(formatToken(match.stake, table.decimals))} · ${escapeHtml(shortAddress(match.p1))} vs ${escapeHtml(opponent)}</span>
  </button>`;
}

function seatOf(match: OnchainMatch, account: string): 0 | 1 | 2 {
  if (sameAddress(match.p1, account)) return 1;
  if (!isZeroAddress(match.p2) && sameAddress(match.p2, account)) return 2;
  return 0;
}

function playerLabel(address: string, me: string): string {
  const name = shortAddress(address);
  return sameAddress(address, me) ? `${name} (you)` : name;
}

function throwLabel(chainChoice: number, committed: string): string {
  if (chainChoice === 1 || chainChoice === 2 || chainChoice === 3) return `revealed ${THROW_NAME[chainChoice]}`;
  if (committed) return `committed ${committed}, still hidden`;
  return 'have not committed';
}

function theirLabel(match: OnchainMatch, seat: 0 | 1 | 2, theirChoice: number): string {
  if (seat === 0) {
    if (match.choice1 && match.choice2) return 'both revealed';
    return 'hidden until reveal';
  }
  if (theirChoice === 1 || theirChoice === 2 || theirChoice === 3) return `revealed ${THROW_NAME[theirChoice]}`;
  if (isZeroAddress(match.p2)) return 'has not joined';
  return 'still hidden';
}

function resultLine(match: OnchainMatch, me: string): string {
  if (match.status !== 3) return '';
  if (match.choice1 === 0 && match.choice2 === 0) return 'Neither throw was revealed. Both stakes can be claimed.';
  if (match.choice1 === 0 || match.choice2 === 0) {
    const winner = match.choice1 !== 0 ? match.p1 : match.p2;
    return `${sameAddress(winner, me) ? 'You take' : shortAddress(winner) + ' takes'} the pot minus the 0.1% fee.`;
  }
  if (match.choice1 === match.choice2) return 'Tie. Both stakes can be claimed. No fee.';
  const winner = beats(match.choice1, match.choice2) ? match.p1 : match.p2;
  return `${sameAddress(winner, me) ? 'You win' : `${shortAddress(winner)} wins`}. The winner claims the pot minus the 0.1% fee.`;
}

function chainName(chainId: number): string {
  return chainId === ANVIL_CHAIN_ID ? 'Anvil' : 'Chain';
}

function disabled(off: boolean): string {
  return off ? 'disabled' : '';
}
