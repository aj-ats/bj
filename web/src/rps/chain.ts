import {
  createPublicClient,
  createWalletClient,
  custom,
  decodeEventLog,
  defineChain,
  encodeFunctionData,
  http,
  type Address,
  type Chain,
  type EIP1193Provider,
  type Hex,
  type PublicClient,
  type TransactionReceipt,
  type WalletClient,
} from 'viem';
import { rpsAbi, usdcAbi } from './abi.ts';
import { ANVIL_CHAIN_ID, LOOKBACK, type ReadyConfig } from './config.ts';
import type { Throw } from './commit.ts';

export interface OnchainMatch {
  id: bigint;
  p1: Address;
  p2: Address;
  stake: bigint;
  choice1: number;
  choice2: number;
  createdAt: bigint;
  revealDeadline: bigint;
  status: number;
}

export interface TableSnapshot {
  chainId: number;
  blockTime: bigint;
  paused: boolean;
  nextMatchId: bigint;
  minStake: bigint;
  joinWindow: bigint;
  revealWindow: bigint;
  decimals: number;
  usdc: bigint;
  eth: bigint;
  claimable: bigint;
  allowance: bigint;
  matches: OnchainMatch[];
}

export function gameChain(config: ReadyConfig): Chain {
  return defineChain({
    id: config.chainId,
    name: config.chainId === ANVIL_CHAIN_ID ? 'Anvil' : `Chain ${config.chainId}`,
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: { default: { http: [config.rpcUrl] } },
  });
}

export function makePublicClient(config: ReadyConfig): PublicClient {
  return createPublicClient({
    chain: gameChain(config),
    transport: http(config.rpcUrl, { batch: { batchSize: 40, wait: 10 } }),
  });
}

export function makeAnvilWallet(config: ReadyConfig): WalletClient {
  return createWalletClient({
    chain: gameChain(config),
    transport: http(config.rpcUrl),
  });
}

export function makeBrowserWallet(config: ReadyConfig, provider: EthereumProvider): WalletClient {
  return createWalletClient({
    chain: gameChain(config),
    transport: custom(provider as EIP1193Provider),
  });
}

export async function loadTable(
  client: PublicClient,
  config: ReadyConfig,
  player: Address,
): Promise<TableSnapshot> {
  const code = await client.getCode({ address: config.rps });
  if (!code || code === '0x') {
    throw new Error('No contract at VITE_RPS_ADDRESS. Deploy, run npm run chain:env, and restart the page.');
  }
  const chainId = await client.getChainId();
  if (chainId !== config.chainId) {
    throw new Error(`This RPC is chain ${chainId}. The page was built for chain ${config.chainId}.`);
  }

  const [token, paused, nextMatchId, claimable, minStake, joinWindow, revealWindow, decimals, usdc, eth, allowance, block] =
    await Promise.all([
      client.readContract({ address: config.rps, abi: rpsAbi, functionName: 'token' }),
      client.readContract({ address: config.rps, abi: rpsAbi, functionName: 'paused' }),
      client.readContract({ address: config.rps, abi: rpsAbi, functionName: 'nextMatchId' }),
      client.readContract({ address: config.rps, abi: rpsAbi, functionName: 'claimable', args: [player] }),
      client.readContract({ address: config.rps, abi: rpsAbi, functionName: 'MIN_STAKE' }),
      client.readContract({ address: config.rps, abi: rpsAbi, functionName: 'JOIN_WINDOW' }),
      client.readContract({ address: config.rps, abi: rpsAbi, functionName: 'REVEAL_WINDOW' }),
      client.readContract({ address: config.usdc, abi: usdcAbi, functionName: 'decimals' }),
      client.readContract({ address: config.usdc, abi: usdcAbi, functionName: 'balanceOf', args: [player] }),
      client.getBalance({ address: player }),
      client.readContract({
        address: config.usdc,
        abi: usdcAbi,
        functionName: 'allowance',
        args: [player, config.rps],
      }),
      client.getBlock(),
    ]);

  if (token.toLowerCase() !== config.usdc.toLowerCase()) {
    throw new Error('VITE_USDC_ADDRESS does not match the token in the RPS contract. Run npm run chain:env.');
  }

  const latest = nextMatchId - 1n;
  const first = latest >= BigInt(LOOKBACK) ? latest - BigInt(LOOKBACK) + 1n : 1n;
  const ids: bigint[] = [];
  for (let id = latest; id >= first && id > 0n; id--) ids.push(id);
  const rows = await Promise.all(
    ids.map((id) => client.readContract({ address: config.rps, abi: rpsAbi, functionName: 'matches', args: [id] })),
  );

  return {
    chainId,
    blockTime: block.timestamp,
    paused,
    nextMatchId,
    minStake,
    joinWindow,
    revealWindow,
    decimals,
    usdc,
    eth,
    claimable,
    allowance,
    matches: rows.map((row, index) => toMatch(ids[index] ?? 0n, row)),
  };
}

export async function createMatch(
  client: PublicClient,
  wallet: WalletClient,
  config: ReadyConfig,
  player: Address,
  commit: Hex,
  stake: bigint,
): Promise<bigint> {
  const receipt = await send(client, wallet, player, config.rps, rpsAbi, 'createMatch', [commit, stake]);
  return createdId(receipt);
}

export async function joinMatch(
  client: PublicClient,
  wallet: WalletClient,
  config: ReadyConfig,
  player: Address,
  id: bigint,
  commit: Hex,
): Promise<void> {
  await send(client, wallet, player, config.rps, rpsAbi, 'joinMatch', [id, commit]);
}

export async function cancelMatch(
  client: PublicClient,
  wallet: WalletClient,
  config: ReadyConfig,
  player: Address,
  id: bigint,
): Promise<void> {
  await send(client, wallet, player, config.rps, rpsAbi, 'cancel', [id]);
}

export async function revealThrow(
  client: PublicClient,
  wallet: WalletClient,
  config: ReadyConfig,
  player: Address,
  id: bigint,
  choice: Throw,
  salt: Hex,
): Promise<void> {
  await send(client, wallet, player, config.rps, rpsAbi, 'reveal', [id, choice, salt]);
}

export async function settleMatch(
  client: PublicClient,
  wallet: WalletClient,
  config: ReadyConfig,
  player: Address,
  id: bigint,
): Promise<void> {
  await send(client, wallet, player, config.rps, rpsAbi, 'settle', [id]);
}

export async function timeoutMatch(
  client: PublicClient,
  wallet: WalletClient,
  config: ReadyConfig,
  player: Address,
  id: bigint,
): Promise<void> {
  await send(client, wallet, player, config.rps, rpsAbi, 'timeout', [id]);
}

export async function claimPayout(
  client: PublicClient,
  wallet: WalletClient,
  config: ReadyConfig,
  player: Address,
): Promise<void> {
  await send(client, wallet, player, config.rps, rpsAbi, 'claim', []);
}

export async function ensureAllowance(
  client: PublicClient,
  wallet: WalletClient,
  config: ReadyConfig,
  player: Address,
  needed: bigint,
): Promise<void> {
  const current = await client.readContract({
    address: config.usdc,
    abi: usdcAbi,
    functionName: 'allowance',
    args: [player, config.rps],
  });
  if (current >= needed) return;
  await send(client, wallet, player, config.usdc, usdcAbi, 'approve', [config.rps, needed]);
}

export async function mintTestUsdc(
  client: PublicClient,
  wallet: WalletClient,
  config: ReadyConfig,
  player: Address,
  amount: bigint,
): Promise<void> {
  await send(client, wallet, player, config.usdc, usdcAbi, 'mint', [player, amount]);
}

async function send(
  client: PublicClient,
  wallet: WalletClient,
  account: Address,
  to: Address,
  abi: typeof rpsAbi | typeof usdcAbi,
  functionName: string,
  args: readonly unknown[],
): Promise<TransactionReceipt> {
  const data = encodeFunctionData({
    abi,
    functionName,
    args,
  } as unknown as Parameters<typeof encodeFunctionData>[0]);
  const chain = client.chain;
  if (!chain) throw new Error('The RPC client has no chain.');
  const hash = await wallet.sendTransaction({ account, to, data, chain });
  const receipt = await client.waitForTransactionReceipt({ hash });
  if (receipt.status !== 'success') throw new Error('The transaction reverted.');
  return receipt;
}

function createdId(receipt: TransactionReceipt): bigint {
  for (const log of receipt.logs) {
    if (log.topics.length === 0) continue;
    try {
      const decoded = decodeEventLog({
        abi: rpsAbi,
        data: log.data,
        topics: log.topics as [Hex, ...Hex[]],
      });
      if (decoded.eventName === 'Created') return decoded.args.matchId;
    } catch {
      // Token logs share the receipt and do not match this ABI.
    }
  }
  throw new Error('The create transaction did not emit a match id.');
}

function toMatch(id: bigint, row: unknown): OnchainMatch {
  const fields = matchFields(row);
  return { id, ...fields };
}

function matchFields(row: unknown): Omit<OnchainMatch, 'id'> {
  if (Array.isArray(row)) {
    return {
      p1: asAddress(row[0]),
      p2: asAddress(row[1]),
      stake: asBigint(row[2]),
      choice1: Number(row[5]),
      choice2: Number(row[6]),
      createdAt: asBigint(row[7]),
      revealDeadline: asBigint(row[8]),
      status: Number(row[9]),
    };
  }
  if (row && typeof row === 'object' && 'p1' in row) {
    const record = row as Record<string, unknown>;
    return {
      p1: asAddress(record.p1),
      p2: asAddress(record.p2),
      stake: asBigint(record.stake),
      choice1: Number(record.choice1),
      choice2: Number(record.choice2),
      createdAt: asBigint(record.createdAt),
      revealDeadline: asBigint(record.revealDeadline),
      status: Number(record.status),
    };
  }
  throw new Error('The chain returned a match in an unexpected shape.');
}

function asAddress(value: unknown): Address {
  if (typeof value !== 'string' || !value.startsWith('0x')) {
    throw new Error('The chain returned a match with a bad address.');
  }
  return value as Address;
}

function asBigint(value: unknown): bigint {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number' || typeof value === 'string') return BigInt(value);
  throw new Error('The chain returned a match with a bad amount.');
}
