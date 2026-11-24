import { bytesToHex, encodeAbiParameters, keccak256, type Hex } from 'viem';

export type Throw = 1 | 2 | 3;

export const THROW_NAME: Record<Throw, string> = {
  1: 'Rock',
  2: 'Paper',
  3: 'Scissors',
};

export function commitHash(choice: Throw, salt: Hex): Hex {
  return keccak256(encodeAbiParameters([{ type: 'uint8' }, { type: 'bytes32' }], [choice, salt]));
}

export function randomSalt(): Hex {
  return bytesToHex(crypto.getRandomValues(new Uint8Array(32)));
}

export function beats(a: number, b: number): boolean {
  return (a === 1 && b === 3) || (a === 3 && b === 2) || (a === 2 && b === 1);
}

export function isThrow(value: number): value is Throw {
  return value === 1 || value === 2 || value === 3;
}
