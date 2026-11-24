import './styles.css';
import { formatSignedUsd, formatUsd } from '../../src/shared/money.ts';
import type {
  DealerCardView,
  GameAction,
  HandView,
  HistoryEntry,
  LeaderboardResponse,
  TableResponse,
} from '../../src/shared/types.ts';

const SUIT_GLYPH: Record<string, string> = { S: '♠', H: '♥', D: '♦', C: '♣' };
const SUIT_NAME: Record<string, string> = { S: 'spades', H: 'hearts', D: 'diamonds', C: 'clubs' };
const RANK_NAME: Record<string, string> = {
  A: 'ace',
  K: 'king',
  Q: 'queen',
  J: 'jack',
  '10': '10',
  '9': '9',
  '8': '8',
  '7': '7',
  '6': '6',
  '5': '5',
  '4': '4',
  '3': '3',
  '2': '2',
};

const CHIPS = [
  { cents: 500, label: '$5', className: 'c5' },
  { cents: 2500, label: '$25', className: 'c25' },
  { cents: 10000, label: '$100', className: 'c100' },
  { cents: 50000, label: '$500', className: 'c500' },
  { cents: 100000, label: '$1k', className: 'c1000' },
  { cents: 500000, label: '$5k', className: 'c5000' },
];

const ACTION_LABEL: Record<GameAction, string> = {
  hit: 'Hit',
  stand: 'Stand',
  double: 'Double',
  split: 'Split',
  insurance: 'Take insurance',
  decline: 'Decline',
  even_money: 'Even money',
};

const KEYS: Record<string, GameAction> = {
  h: 'hit',
  s: 'stand',
  d: 'double',
  p: 'split',
  i: 'insurance',
  n: 'decline',
  e: 'even_money',
};

class ApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

let table: TableResponse | null = null;
let leaders: LeaderboardResponse | null = null;
let history: HistoryEntry[] = [];
let betCents = 0;
let busy = false;
let errorMessage: string | null = null;
let editingName = false;

const app = document.querySelector('#app');
if (!app) throw new Error('Missing #app');

document.body.addEventListener('click', (event) => {
  const target = (event.target as HTMLElement | null)?.closest<HTMLElement>('[data-action], [data-add]');
  if (!target || busy) return;
  const add = target.dataset.add;
  if (add) {
    addChip(Number(add));
    return;
  }
  const action = target.dataset.action;
  if (action === 'deal') void run(() => deal());
  else if (action === 'clear-bet') {
    betCents = 0;
    renderStage();
  } else if (action === 'edit-name') {
    editingName = true;
    renderTop();
  } else if (action === 'cancel-name') {
    editingName = false;
    renderTop();
  } else if (action === 'new-session') void run(() => newSession());
  else if (action === 'forfeit') void run(() => forfeit());
  else if (action && isAction(action)) void run(() => act(action));
});

document.body.addEventListener('submit', (event) => {
  const form = event.target;
  if (!(form instanceof HTMLFormElement) || form.dataset.action !== 'rename') return;
  event.preventDefault();
  const input = form.elements.namedItem('displayName');
  const name = input instanceof HTMLInputElement ? input.value : '';
  void run(async () => {
    table = await request<TableResponse>('/api/session/name', {
      method: 'POST',
      body: JSON.stringify({ displayName: name }),
    });
    editingName = false;
    leaders = await request<LeaderboardResponse>('/api/leaderboard');
  });
});

window.addEventListener('keydown', (event) => {
  if (event.metaKey || event.ctrlKey || event.altKey) return;
  const target = event.target;
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return;
  const action = KEYS[event.key.toLowerCase()];
  if (!action || busy || !table?.round?.actions.includes(action)) return;
  event.preventDefault();
  void run(() => act(action));
});

void boot();
window.setInterval(() => {
  if (document.hidden) return;
  void refreshBoard();
}, 8000);

async function boot(): Promise<void> {
  try {
    table = await request<TableResponse>('/api/session');
    betCents = defaultBet();
    history = (await request<{ hands: HistoryEntry[] }>('/api/history')).hands;
    leaders = await request<LeaderboardResponse>('/api/leaderboard');
    renderAll();
  } catch (error) {
    app!.innerHTML = `<main class="app"><p class="alert">${escapeHtml(messageOf(error))}</p></main>`;
  }
}

async function run(task: () => Promise<void>): Promise<void> {
  if (busy) return;
  busy = true;
  errorMessage = null;
  renderStage();
  try {
    await task();
  } catch (error) {
    errorMessage = messageOf(error);
  } finally {
    busy = false;
    renderAll();
  }
}

async function deal(): Promise<void> {
  table = await request<TableResponse>('/api/bet', {
    method: 'POST',
    body: JSON.stringify({ amountCents: betCents }),
  });
  await refreshAfterHand();
}

async function act(type: GameAction): Promise<void> {
  table = await request<TableResponse>('/api/action', {
    method: 'POST',
    body: JSON.stringify({ type }),
  });
  await refreshAfterHand();
}

async function forfeit(): Promise<void> {
  if (!window.confirm('Forfeit this hand? The chips already bet stay with the house.')) return;
  table = await request<TableResponse>('/api/session/abandon', { method: 'POST' });
  history = (await request<{ hands: HistoryEntry[] }>('/api/history')).hands;
  leaders = await request<LeaderboardResponse>('/api/leaderboard');
}

async function newSession(): Promise<void> {
  if (table?.round && table.round.phase !== 'done') {
    const ok = window.confirm('A hand is in progress. Forfeiting pays the bet to the house and opens a new session.');
    if (!ok) return;
    await request('/api/session/abandon', { method: 'POST' });
  }
  table = await request<TableResponse>('/api/session', { method: 'POST' });
  history = [];
  betCents = defaultBet();
  leaders = await request<LeaderboardResponse>('/api/leaderboard');
}

async function refreshAfterHand(): Promise<void> {
  if (table?.round?.phase !== 'done') return;
  history = (await request<{ hands: HistoryEntry[] }>('/api/history')).hands;
  leaders = await request<LeaderboardResponse>('/api/leaderboard');
}

async function refreshBoard(): Promise<void> {
  try {
    leaders = await request<LeaderboardResponse>('/api/leaderboard');
    renderBoard();
  } catch {
    // Keep the last board if the poll fails.
  }
}

function addChip(amount: number): void {
  if (!table) return;
  const cap = wholeDollars(table.session.bankrollCents);
  betCents = Math.min(cap, betCents + amount);
  renderStage();
}

function defaultBet(): number {
  if (!table) return 0;
  const cap = wholeDollars(table.session.bankrollCents);
  const preferred = 2500;
  if (preferred <= cap) return preferred;
  return cap;
}

function wholeDollars(cents: number): number {
  return cents - (cents % 100);
}

function dealEnabled(): boolean {
  if (!table || busy || table.session.banned) return false;
  if (table.round && table.round.phase !== 'done') return false;
  return betCents >= 100 && betCents <= table.session.bankrollCents && betCents % 100 === 0;
}

function renderAll(): void {
  renderTop();
  renderStage();
  renderBoard();
}

function renderTop(): void {
  if (!table) return;
  const root = ensureShell();
  const name = table.session.displayName;
  const nameControl = editingName
    ? `<form data-action="rename" class="name-row">
        <input name="displayName" value="${escapeHtml(name)}" maxlength="24" aria-label="Table name">
        <button class="ghost" type="submit">Save</button>
        <button class="ghost" type="button" data-action="cancel-name">Cancel</button>
      </form>`
    : `<div class="name-row">
        <span data-testid="display-name">${escapeHtml(name)}</span>
        <button class="text-button" type="button" data-action="edit-name">Rename</button>
      </div>`;
  root.querySelector('#top')!.innerHTML = `
    <div class="brand">
      <h1>FREE BJ</h1>
      <p>Practice chips. Same rules as a shoe game.</p>
    </div>
    <div class="stack">
      <p>Stack</p>
      <strong data-testid="bankroll">${formatUsd(table.session.bankrollCents)}</strong>
      <p>Ran up ${formatUsd(table.session.peakBankrollCents)} · ${table.session.handsPlayed} hands</p>
      ${nameControl}
      <div class="session-actions">
        <button class="ghost" type="button" data-action="new-session">New session</button>
      </div>
    </div>`;
}

function renderStage(): void {
  if (!table) return;
  const root = ensureShell();
  const round = table.round;
  const dealer = round
    ? cardsHtml(round.dealerCards, round.dealerTotal, round.dealerSoft)
    : `<p class="fine">Dealer stands by for the next bet.</p>`;
  const hands = round ? round.hands.map((hand) => handHtml(hand)).join('') : '';
  const banner = bannerHtml();
  const prompt = round?.phase === 'insurance'
    ? `<p class="note">${round.insuranceKind === 'even_money' ? 'Blackjack. The dealer shows an ace. Even money pays 1 to 1 now.' : 'Dealer shows an ace. Insurance pays 2 to 1 if the hole card is a ten.'}</p>`
    : '';
  const actions = round && round.phase !== 'done'
    ? `<div class="actions">${round.actions.map((action) => actionButton(action)).join('')}
        <button class="action danger" type="button" data-action="forfeit">Forfeit hand</button></div>`
    : '';
  const chips = CHIPS.filter((chip) => chip.cents <= table!.session.bankrollCents)
    .map((chip) => `<button class="chip ${chip.className}" type="button" data-add="${chip.cents}" ${busy || table!.session.banned ? 'disabled' : ''}>${chip.label}</button>`)
    .join('');
  const limits = table.limits;
  root.querySelector('#stage')!.innerHTML = `
    <div class="rail">
      <div class="felt" data-busy="${busy ? 'true' : 'false'}">
        ${errorMessage ? `<p class="alert" role="alert">${escapeHtml(errorMessage)}</p>` : ''}
        ${table.session.banned ? '<p class="alert">The house closed this session.</p>' : ''}
        ${table.session.hiddenFromBoard ? '<p class="note">This table is hidden from the leaderboard.</p>' : ''}
        <section class="spot" aria-label="Dealer">
          <h2>Dealer ${round?.dealerTotal != null ? `· ${totalText(round.dealerTotal, round.dealerSoft)}` : ''}</h2>
          ${dealer}
        </section>
        <div class="banner" aria-live="polite">${prompt}${banner}</div>
        <section class="hands">${hands}</section>
        <div class="controls">
          <div class="bet-line">
            <span>Bet</span>
            <strong data-testid="bet">${formatUsd(betCents)}</strong>
          </div>
          <div class="chips">${chips}<button class="ghost" type="button" data-action="clear-bet">Clear</button></div>
          <div class="deal-row">
            <button class="deal" type="button" data-testid="deal" data-action="deal" ${dealEnabled() ? '' : 'disabled'}>Deal ${formatUsd(betCents)}</button>
          </div>
          ${actions}
          ${round && round.inPlayCents > 0 ? `<p class="fine">In play ${formatUsd(round.inPlayCents)}. Those chips already left the stack.</p>` : ''}
        </div>
      </div>
    </div>
    <section class="history">
      <h2>This session</h2>
      ${history.length === 0 ? '<p class="fine">No hands yet.</p>' : `<ol>${history.map((hand) => `<li><span>${escapeHtml(hand.description)}</span><span class="${hand.netCents >= 0 ? 'win' : 'loss'}">${formatSignedUsd(hand.netCents)}<span>wager ${formatUsd(hand.wagerCents)}</span></span></li>`).join('')}</ol>`}
    </section>
    <details class="rules">
      <summary>House rules</summary>
      <ul>
        <li>${limits.decks === 1 ? 'One deck' : `${limits.decks} decks`}. The shoe is cut after about three quarters of the cards, between hands.</li>
        <li>Dealer ${limits.hitSoft17 ? 'hits' : 'stands on'} soft 17.</li>
        <li>Blackjack pays 3 to 2. A 21 after a split pays 1 to 1.</li>
        <li>Dealer peeks. Insurance pays 2 to 1. On your own blackjack against an ace, that is even money.</li>
        <li>Double any first two cards, including after a split. Split equal values into at most four hands. Split aces take one card and cannot be resplit.</li>
        <li>Ties push. A bust loses even when the dealer would have busted.</li>
        <li>New sessions start with ${formatUsd(limits.startingBankrollCents)}. A bet is any whole-dollar amount the stack can cover.</li>
        <li>Keys: H hit, S stand, D double, P split.</li>
      </ul>
    </details>
    <div class="footer">
      <span>Fake chips. Nothing on this table is redeemable.</span>
      <span class="footer-links">
        <a href="/rps">Rock paper scissors</a>
        <a href="/admin">House</a>
      </span>
    </div>`;
}

function renderBoard(): void {
  const root = ensureShell();
  const rows = leaders?.leaders ?? [];
  const pinned = leaders?.you && !rows.some((row) => row.you) ? leaders.you : null;
  root.querySelector('#board')!.innerHTML = `
    <h2>Who ran it up</h2>
    <p class="fine">Ranked by the highest stack a session reached.</p>
    ${rows.length === 0 ? '<p>No finished hands yet.</p>' : `<ol data-testid="leaderboard">${rows.map((row) => leaderItem(row)).join('')}</ol>`}
    ${pinned ? `<ol data-testid="leaderboard-you">${leaderItem(pinned)}</ol>` : ''}`;
}

function leaderItem(row: LeaderboardResponse['leaders'][number]): string {
  return `<li class="${row.you ? 'you' : ''}">
    <span class="rank">#${row.rank}</span>
    <span>${escapeHtml(row.displayName)}${row.you ? ' · you' : ''}<span class="fine">${row.handsPlayed} hands</span></span>
    <span class="money">${formatUsd(row.peakBankrollCents)}<span>now ${formatUsd(row.bankrollCents)}</span></span>
  </li>`;
}

function ensureShell(): HTMLElement {
  if (!app!.querySelector('#stage')) {
    app!.innerHTML = `<main class="app"><header id="top" class="top"></header><div class="layout"><div id="stage"></div><aside id="board" class="board"></aside></div></main>`;
  }
  return app as HTMLElement;
}

function bannerHtml(): string {
  const round = table?.round;
  if (!round?.description || round.netCents == null) return '';
  const tone = round.netCents > 0 ? 'win' : round.netCents < 0 ? 'loss' : '';
  return `<p data-testid="result" class="${tone}">${escapeHtml(round.description)} <strong>${formatSignedUsd(round.netCents)}</strong></p>`;
}

function handHtml(hand: HandView): string {
  return `<article class="hand ${hand.active ? 'active' : ''} ${hand.status}">
    <header><span>${escapeHtml(hand.label)}</span><span>${escapeHtml(statusLabel(hand.status))}</span></header>
    <div class="hand-cards">${hand.cards.map((dealt) => faceCard(dealt)).join('')}</div>
    <div class="total"><span>${totalText(hand.total, hand.soft)}</span><span>${formatUsd(hand.betCents)}</span></div>
  </article>`;
}

function cardsHtml(cards: DealerCardView[], total: number | null, soft: boolean): string {
  const faces = cards.map((dealt) => ('hidden' in dealt ? backCard() : faceCard(dealt))).join('');
  return `<div class="cards">${faces}</div>${total == null ? '' : `<p class="fine">${totalText(total, soft)}</p>`}`;
}

function faceCard(dealt: { rank: string; suit: string }): string {
  const red = dealt.suit === 'H' || dealt.suit === 'D' ? ' red' : '';
  const glyph = SUIT_GLYPH[dealt.suit] ?? dealt.suit;
  const label = `${RANK_NAME[dealt.rank] ?? dealt.rank} of ${SUIT_NAME[dealt.suit] ?? dealt.suit}`;
  return `<div class="card${red}" role="img" aria-label="${escapeHtml(label)}"><span class="corner">${escapeHtml(dealt.rank)}<b>${glyph}</b></span><span class="pip">${glyph}</span><span class="corner flip">${escapeHtml(dealt.rank)}<b>${glyph}</b></span></div>`;
}

function backCard(): string {
  return '<div class="card back" role="img" aria-label="Hole card"></div>';
}

function actionButton(action: GameAction): string {
  const shortcut = Object.entries(KEYS).find(([, value]) => value === action)?.[0]?.toUpperCase();
  return `<button class="action${action === 'stand' || action === 'decline' ? ' secondary' : ''}" type="button" data-testid="action-${action}" data-action="${action}" aria-label="${ACTION_LABEL[action]}" ${busy ? 'disabled' : ''}>${ACTION_LABEL[action]}${shortcut ? `<kbd aria-hidden="true">${shortcut}</kbd>` : ''}</button>`;
}

function statusLabel(status: HandView['status']): string {
  if (status === 'playing') return 'Playing';
  if (status === 'waiting') return 'Waiting';
  if (status === 'stood') return 'Stand';
  if (status === 'bust') return 'Bust';
  if (status === 'blackjack') return 'Blackjack';
  if (status === 'win') return 'Win';
  if (status === 'lose') return 'Lose';
  return 'Push';
}

function totalText(total: number, soft: boolean): string {
  return soft ? `Soft ${total}` : String(total);
}

function isAction(value: string): value is GameAction {
  return value in ACTION_LABEL;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...init.headers,
    },
    credentials: 'same-origin',
  });
  const text = await response.text();
  const data = text ? (JSON.parse(text) as { error?: string }) : {};
  if (!response.ok) throw new ApiError(data.error ?? 'Request failed');
  return data as T;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong';
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    const map: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
    return map[character] ?? character;
  });
}
