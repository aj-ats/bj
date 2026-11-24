/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_RPS_CHAIN_ID?: string;
  readonly VITE_RPS_RPC_URL?: string;
  readonly VITE_RPS_ADDRESS?: string;
  readonly VITE_USDC_ADDRESS?: string;
}

interface EthereumProvider {
  request(args: { method: string; params?: readonly unknown[] | object }): Promise<unknown>;
}

interface Window {
  ethereum?: EthereumProvider;
}
