/**
 * Plays one RPS match in Chromium against a throwaway Anvil.
 * Ports 18545 and 4179 stay off the default chain and Vite ports.
 * Restores contracts/broadcast/local.json so this deploy does not replace a developer's file.
 */
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { existsSync, openSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { createConnection } from 'node:net';
import { join } from 'node:path';
import { chromium, type Page } from 'playwright';

const ROOT = join(import.meta.dirname, '../..');
const RPC = 'http://127.0.0.1:18545';
const PAGE = 'http://127.0.0.1:4179/rps';
const ANVIL_PORT = 18545;
const VITE_PORT = 4179;
const JSON_PATH = join(ROOT, 'contracts/broadcast/local.json');
const ALICE = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
const BOB = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';
const FEE = '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC';
const ALICE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';

const env = {
  ...process.env,
  PATH: `${process.env.HOME ?? ''}/.foundry/bin:${process.env.PATH ?? ''}`,
};

async function main(): Promise<void> {
  if (await portOpen(ANVIL_PORT)) throw new Error(`Port ${ANVIL_PORT} is already in use.`);
  if (await portOpen(VITE_PORT)) throw new Error(`Port ${VITE_PORT} is already in use.`);

  const backup = existsSync(JSON_PATH) ? readFileSync(JSON_PATH) : null;
  let anvil: ChildProcess | null = null;
  let vite: ChildProcess | null = null;
  let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null;

  try {
    anvil = start('anvil', ['--host', '127.0.0.1', '--port', String(ANVIL_PORT), '--chain-id', '31337'], '/tmp/rps-ui-anvil.log');
    await waitForChain();
    deploy();
    const addresses = JSON.parse(readFileSync(JSON_PATH, 'utf8')) as { usdc: string; rps: string; chainId: number };
    if (addresses.chainId !== 31337) throw new Error(`Deploy wrote chain ${addresses.chainId}.`);

    vite = start(process.execPath, [join(ROOT, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', String(VITE_PORT), '--strictPort'], '/tmp/rps-ui-vite.log', {
      VITE_RPS_CHAIN_ID: '31337',
      VITE_RPS_RPC_URL: RPC,
      VITE_RPS_ADDRESS: addresses.rps,
      VITE_USDC_ADDRESS: addresses.usdc,
    });
    await waitForPage();

    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    try {
      await play(page, addresses.usdc, addresses.rps);
    } catch (error) {
      await page.screenshot({ path: '/tmp/rps-ui.png', fullPage: true }).catch(() => undefined);
      const text = await page.locator('body').innerText().catch(() => '');
      console.error(text);
      throw error;
    }
  } finally {
    await browser?.close().catch(() => undefined);
    stop(vite);
    stop(anvil);
    if (backup) writeFileSync(JSON_PATH, backup);
    else if (existsSync(JSON_PATH)) unlinkSync(JSON_PATH);
  }
}

async function play(page: Page, usdc: string, rps: string): Promise<void> {
  await page.goto(PAGE);
  await page.getByTestId('ready').waitFor();
  await click(page, 'faucet');
  await waitText(page, 'usdc-balance', '1,000.00');

  await click(page, 'throw-1');
  await click(page, 'stake-20');
  await click(page, 'create');
  await waitText(page, 'match-id', '1');
  await waitText(page, 'match-status', 'Waiting');
  await click(page, 'cancel');
  await waitText(page, 'match-status', 'Cancelled');
  await click(page, 'claim');
  await waitText(page, 'usdc-balance', '1,000.00');
  await page.waitForFunction(() => document.querySelector('[data-testid="claim"]') === null);

  await click(page, 'throw-1');
  await click(page, 'create');
  await waitText(page, 'match-id', '2');
  await waitText(page, 'match-status', 'Waiting');

  await click(page, 'seat-bob');
  await waitText(page, 'seat-address', '0x7099…79C8');
  await click(page, 'faucet');
  await waitText(page, 'usdc-balance', '1,000.00');
  await click(page, 'match-2');
  await click(page, 'throw-3');
  await click(page, 'join');
  await waitText(page, 'match-status', 'Reveal');

  await click(page, 'seat-alice');
  await waitText(page, 'seat-address', '0xf39F…2266');
  await click(page, 'reveal');
  await waitText(page, 'your-throw', 'You revealed Rock');
  await click(page, 'seat-bob');
  await click(page, 'reveal');
  await waitText(page, 'your-throw', 'You revealed Scissors');
  await click(page, 'settle');
  await waitText(page, 'match-status', 'Settled');

  await click(page, 'seat-alice');
  await click(page, 'claim');
  await waitText(page, 'usdc-balance', '1,019.96');
  await click(page, 'seat-bob');
  await waitText(page, 'usdc-balance', '980.00');

  const alice = castBalance(usdc, ALICE);
  const bob = castBalance(usdc, BOB);
  const fee = castBalance(usdc, rps);
  assertBalance('alice', alice, 1_019_960_000n);
  assertBalance('bob', bob, 980_000_000n);
  assertBalance('fee left in the contract', fee, 40_000n);
  if (castBalance(usdc, FEE) !== 0n) throw new Error('The fee account was paid before it claimed.');
  console.log('rps ui check passed');
}

function assertBalance(label: string, got: bigint, expected: bigint): void {
  if (got !== expected) throw new Error(`${label} balance ${got.toString()} != ${expected.toString()}`);
  console.log(`ok  ${label} ${got.toString()}`);
}

function castBalance(token: string, account: string): bigint {
  const out = execFileSync('cast', ['call', '--rpc-url', RPC, token, 'balanceOf(address)(uint256)', account], {
    encoding: 'utf8',
    env,
  });
  return BigInt(out.replace(/\[.*$/s, '').trim());
}

async function click(page: Page, id: string): Promise<void> {
  const locator = page.getByTestId(id);
  await locator.waitFor({ state: 'visible', timeout: 20_000 });
  await page.waitForFunction((testId) => {
    const el = document.querySelector(`[data-testid="${testId}"]`);
    return el instanceof HTMLButtonElement && !el.disabled;
  }, id, { timeout: 20_000 });
  await locator.click();
}

async function waitText(page: Page, id: string, expected: string): Promise<void> {
  const locator = page.getByTestId(id);
  await locator.waitFor({ state: 'visible', timeout: 20_000 });
  const deadline = Date.now() + 20_000;
  let last = '';
  while (Date.now() < deadline) {
    last = (await locator.innerText()).trim();
    if (last === expected) return;
    await page.waitForTimeout(200);
  }
  throw new Error(`[data-testid=${id}] was ${JSON.stringify(last)}, expected ${JSON.stringify(expected)}`);
}

function deploy(): void {
  const result = execFileSync(
    'forge',
    ['script', 'script/Deploy.s.sol:Deploy', '--rpc-url', RPC, '--broadcast', '--private-key', ALICE_KEY],
    {
      cwd: join(ROOT, 'contracts'),
      env: { ...env, PRIVATE_KEY: ALICE_KEY, FEE_RECIPIENT: FEE },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  if (!existsSync(JSON_PATH)) {
    throw new Error(`Deploy did not write local.json.\n${result}`);
  }
}

function start(command: string, args: string[], logPath: string, extra: Record<string, string> = {}): ChildProcess {
  const log = openSync(logPath, 'w');
  const child = spawn(command, args, {
    cwd: ROOT,
    detached: true,
    env: { ...env, ...extra },
    stdio: ['ignore', log, log],
  });
  child.unref();
  return child;
}

function stop(child: ChildProcess | null): void {
  if (!child?.pid) return;
  try {
    process.kill(-child.pid, 'SIGTERM');
  } catch {
    try {
      child.kill('SIGTERM');
    } catch {
      // The process already exited.
    }
  }
}

async function waitForChain(): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(RPC, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }),
      });
      const body = (await response.json()) as { result?: string };
      if (body.result === '0x7a69') return;
    } catch {
      // Anvil is still starting.
    }
    await sleep(200);
  }
  throw new Error(`Anvil did not answer on ${RPC}. See /tmp/rps-ui-anvil.log`);
}

async function waitForPage(): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(PAGE);
      if (response.ok && (await response.text()).includes('RPS')) return;
    } catch {
      // Vite is still starting.
    }
    await sleep(200);
  }
  throw new Error(`Vite did not serve ${PAGE}. See /tmp/rps-ui-vite.log`);
}

function portOpen(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ port, host: '127.0.0.1' });
    const finish = (open: boolean) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(open);
    };
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
