import type { Address, Hex } from 'viem';
import { isThrow, type Throw } from './commit.ts';

export interface SavedThrow {
  choice: Throw;
  salt: Hex;
}

interface ThrowKey {
  chainId: number;
  rps: Address;
  player: Address;
  matchId: bigint;
}

const PREFIX = 'freebj.rps.v1';

function storageKey(key: ThrowKey): string {
  return [
    PREFIX,
    String(key.chainId),
    key.rps.toLowerCase(),
    key.player.toLowerCase(),
    key.matchId.toString(),
  ].join(':');
}

export function saveThrow(key: ThrowKey, value: SavedThrow): void {
  localStorage.setItem(storageKey(key), JSON.stringify(value));
}

export function loadThrow(key: ThrowKey): SavedThrow | null {
  const raw = localStorage.getItem(storageKey(key));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { choice?: unknown; salt?: unknown };
    if (typeof parsed.choice !== 'number' || !isThrow(parsed.choice)) return null;
    if (typeof parsed.salt !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(parsed.salt)) return null;
    return { choice: parsed.choice, salt: parsed.salt as Hex };
  } catch {
    return null;
  }
}
