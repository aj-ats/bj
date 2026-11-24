import { BaseError, ContractFunctionRevertedError } from 'viem';

const REVERT_TEXT: Record<string, string> = {
  GameIsPaused: 'New matches are paused. Cancel, reveal, settle, and claim still work.',
  BadReveal: 'The salt in this browser does not match the commit on the contract.',
  BadChoice: 'The throw has to be rock, paper, or scissors.',
  BadStatus: 'That action does not match the match.',
  TooEarly: 'The reveal window is still open.',
  Expired: 'The join window has closed.',
  SamePlayer: 'You cannot join your own match.',
  NotPlayer: 'Only the creator can cancel this lobby right now.',
  NothingToClaim: 'There is nothing to claim.',
  BadStake: 'The stake is below 1 USDC.',
  BadCommit: 'The commit is empty.',
  InsufficientBalance: 'This seat does not have enough USDC.',
  InsufficientAllowance: 'The token allowance is short. Try the action again.',
  AlreadyRevealed: 'This seat already revealed.',
  TransferFailed: 'The token transfer failed.',
};

export function formatToken(amount: bigint, decimals: number): string {
  const base = 10n ** BigInt(decimals);
  const whole = amount / base;
  const frac = amount % base;
  const digits = frac.toString().padStart(decimals, '0').slice(0, 2).padEnd(2, '0');
  const grouped = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${grouped}.${digits}`;
}

export function parseWholeToken(whole: number, decimals: number): bigint {
  return BigInt(whole) * 10n ** BigInt(decimals);
}

export function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function sameAddress(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

export function isZeroAddress(address: string): boolean {
  return /^0x0{40}$/i.test(address);
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

const STATUS = ['Empty', 'Waiting', 'Reveal', 'Settled', 'Cancelled'];

export function statusName(status: number): string {
  return STATUS[status] ?? 'Unknown';
}

export function clockLeft(deadline: bigint, now: bigint): string {
  if (deadline === 0n) return '';
  const left = deadline - now;
  if (left <= 0n) return 'Window closed';
  const minutes = left / 60n;
  const seconds = left % 60n;
  return `${minutes}m ${seconds.toString().padStart(2, '0')}s left`;
}

export function errorText(error: unknown): string {
  if (isReject(error)) return 'The wallet rejected the request.';
  if (error instanceof BaseError) {
    const revert = error.walk((item) => item instanceof ContractFunctionRevertedError);
    if (revert instanceof ContractFunctionRevertedError) {
      const name = revert.data?.errorName ?? '';
      if (name && REVERT_TEXT[name]) return REVERT_TEXT[name];
      if (name) return name;
    }
    return error.shortMessage || error.message;
  }
  if (error instanceof Error && error.message) return error.message;
  return 'Something went wrong.';
}

function isReject(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 4001;
}
