import type { Pool } from 'pg';
import type { Rules } from './game/engine.ts';
import type { ShoeSource } from './game/shoe.ts';

export interface AppDeps {
  leaderboard: Pool;
  admin: Pool;
  shoeSource: ShoeSource;
  rulesOverride?: Partial<Pick<Rules, 'reshuffleBelow'>>;
  cookieSecure: boolean;
  staticDir?: string;
  /** Origin allowed by CSP in addition to the local Anvil RPC. Not a secret. */
  rpsRpcUrl?: string;
}

export type AppEnv = { Variables: { adminUser: string } };
