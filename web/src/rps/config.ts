import { isAddress, type Address } from 'viem';

export const ANVIL_CHAIN_ID = 31337;
export const ANVIL_ALICE: Address = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
export const ANVIL_BOB: Address = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';

/** Latest matches the page reads. An indexer can replace this scan later. */
export const LOOKBACK = 30;

export interface RpsConfig {
  chainId: number;
  rpcUrl: string;
  rps: Address | null;
  usdc: Address | null;
  problem: string | null;
}

export interface ReadyConfig extends RpsConfig {
  rps: Address;
  usdc: Address;
}

function readAddress(value: string | undefined): Address | null {
  const trimmed = value?.trim() ?? '';
  if (!trimmed) return null;
  return isAddress(trimmed) ? trimmed : null;
}

export function loadRpsConfig(env: ImportMetaEnv = import.meta.env): RpsConfig {
  const parsedChain = Number(env.VITE_RPS_CHAIN_ID ?? ANVIL_CHAIN_ID);
  const chainId = Number.isInteger(parsedChain) && parsedChain > 0 ? parsedChain : ANVIL_CHAIN_ID;
  const rpsRaw = env.VITE_RPS_ADDRESS?.trim() ?? '';
  const usdcRaw = env.VITE_USDC_ADDRESS?.trim() ?? '';
  const rps = readAddress(rpsRaw);
  const usdc = readAddress(usdcRaw);
  const problems: string[] = [];
  if (rpsRaw && !rps) problems.push('VITE_RPS_ADDRESS is not an address.');
  if (usdcRaw && !usdc) problems.push('VITE_USDC_ADDRESS is not an address.');
  return {
    chainId,
    rpcUrl: env.VITE_RPS_RPC_URL?.trim() || 'http://127.0.0.1:8545',
    rps,
    usdc,
    problem: problems.length > 0 ? problems.join(' ') : null,
  };
}

export function configReady(config: RpsConfig): config is ReadyConfig {
  return config.rps !== null && config.usdc !== null && config.problem === null;
}
