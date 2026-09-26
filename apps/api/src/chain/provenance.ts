import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export type Hex = `0x${string}`;
export type AnchorStatus = 'pending' | 'submitted' | 'confirmed' | 'failed';
export type ChainProblem =
  | 'deployment_missing'
  | 'rpc_unconfigured'
  | 'rpc_unavailable'
  | 'chain_mismatch'
  | 'registry_not_deployed'
  | 'signer_unavailable'
  | 'broadcast_failed'
  | 'receipt_mismatch';

export type ChainConfig = {
  chainId: number;
  registryAddress: Hex | null;
  deploymentBlock?: number | null;
  rpcUrl: string | null;
  account: string | null;
  passwordFile: string | null;
};

export type ReceiptResult =
  | { state: 'waiting' }
  | { state: 'confirmed' }
  | { state: 'failed'; reason: ChainProblem };

export interface ChainGateway {
  readonly config: ChainConfig;
  findExisting(lotHash: Hex, payloadHash: Hex): Promise<Hex | null>;
  submit(lotHash: Hex, payloadHash: Hex, uri: string): Promise<Hex>;
  receipt(txHash: Hex, lotHash: Hex, payloadHash: Hex): Promise<ReceiptResult>;
}

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const HASH = /^0x[0-9a-fA-F]{64}$/;
const ANCHORED_TOPIC = '0xc963b62fcab47ee98618999ec6878152a4dcaa1329a800227b6e49451c23bf0c';
const ANCHORER_SELECTOR = '0x84609921';

export class ChainUnavailable extends Error {
  constructor(readonly reason: ChainProblem) {
    super(reason);
  }
}

export function canonicalJson(value: unknown): string {
  function sorted(input: unknown): unknown {
    if (Array.isArray(input)) return input.map(sorted);
    if (input !== null && typeof input === 'object') {
      return Object.fromEntries(
        Object.entries(input).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => [key, sorted(item)]),
      );
    }
    return input;
  }
  const json = JSON.stringify(sorted(value));
  if (json === undefined) throw new Error('Cannot hash an undefined value');
  return json;
}

export async function sha256Hex(input: string): Promise<Hex> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return `0x${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

export function explorerUrl(chainId: number, txHash: string | null): string | null {
  if (!txHash || !HASH.test(txHash)) return null;
  const origin = chainId === 1
    ? 'https://etherscan.io'
    : chainId === 11155111 ? 'https://sepolia.etherscan.io' : null;
  return origin ? `${origin}/tx/${txHash}` : null;
}

export function loadChainConfig(env: NodeJS.ProcessEnv = process.env): ChainConfig {
  const chainId = Number(env.REELDEAL_CHAIN_ID ?? '1');
  if (!Number.isSafeInteger(chainId) || chainId <= 0) throw new Error('Invalid REELDEAL_CHAIN_ID');

  const manifestPath = resolve(import.meta.dir, `../../../../deployments/${chainId}.json`);
  let registryAddress: unknown = null;
  let deploymentBlock: unknown = null;
  if (existsSync(manifestPath)) {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, unknown>;
    if (manifest.chainId !== chainId) throw new Error('Deployment manifest chain ID mismatch');
    registryAddress = manifest.registryAddress;
    deploymentBlock = manifest.deploymentBlock;
  }
  registryAddress = env.REELDEAL_REGISTRY_ADDRESS ?? registryAddress;
  deploymentBlock = env.REELDEAL_DEPLOYMENT_BLOCK ?? deploymentBlock;
  if (registryAddress !== null && (typeof registryAddress !== 'string' || !ADDRESS.test(registryAddress))) {
    throw new Error('Invalid registry address');
  }
  if (deploymentBlock !== null) {
    const block = Number(deploymentBlock);
    if (!Number.isSafeInteger(block) || block < 0) {
      throw new Error('Invalid deployment block');
    }
    deploymentBlock = block;
  }

  return {
    chainId,
    registryAddress: registryAddress as Hex | null,
    deploymentBlock: deploymentBlock as number | null,
    rpcUrl: env.REELDEAL_RPC_URL ?? null,
    account: env.REELDEAL_ANCHOR_ACCOUNT ?? null,
    passwordFile: env.REELDEAL_ANCHOR_PASSWORD_FILE ?? null,
  };
}

type RpcReceipt = {
  status: string;
  logs: Array<{ address: string; topics: string[]; data: string }>;
};

type RpcLog = { address: string; topics: string[]; data: string; transactionHash: string; removed?: boolean };

export class CastChainGateway implements ChainGateway {
  constructor(readonly config: ChainConfig) {}

  private async rpc<T>(method: string, params: unknown[]): Promise<T> {
    if (!this.config.rpcUrl) throw new ChainUnavailable('rpc_unconfigured');
    try {
      const response = await fetch(this.config.rpcUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
        signal: AbortSignal.timeout(12_000),
      });
      if (!response.ok) throw new Error('RPC HTTP failure');
      const body = await response.json() as { result?: T; error?: unknown };
      if (body.error || body.result === undefined) throw new Error('RPC result failure');
      return body.result;
    } catch {
      throw new ChainUnavailable('rpc_unavailable');
    }
  }

  private async verifyNetwork(): Promise<Hex> {
    const address = this.config.registryAddress;
    if (!address) throw new ChainUnavailable('deployment_missing');
    const actualChainId = Number.parseInt(await this.rpc<string>('eth_chainId', []), 16);
    if (actualChainId !== this.config.chainId) throw new ChainUnavailable('chain_mismatch');
    const code = await this.rpc<string>('eth_getCode', [address, 'latest']);
    if (!code || code === '0x') throw new ChainUnavailable('registry_not_deployed');
    return address;
  }

  async findExisting(lotHash: Hex, payloadHash: Hex): Promise<Hex | null> {
    const registry = await this.verifyNetwork();
    const fromBlock = this.config.deploymentBlock;
    if (fromBlock === null || fromBlock === undefined) throw new ChainUnavailable('deployment_missing');
    const logs = await this.rpc<RpcLog[]>('eth_getLogs', [{
      address: registry,
      fromBlock: `0x${fromBlock.toString(16)}`,
      toBlock: 'latest',
      topics: [ANCHORED_TOPIC, lotHash],
    }]);
    const matching = logs.find((log) =>
      !log.removed
      && log.address.toLowerCase() === registry.toLowerCase()
      && log.topics[0]?.toLowerCase() === ANCHORED_TOPIC
      && log.topics[1]?.toLowerCase() === lotHash.toLowerCase()
      && `0x${log.data.slice(2, 66)}`.toLowerCase() === payloadHash.toLowerCase()
      && HASH.test(log.transactionHash)
    );
    return matching ? matching.transactionHash as Hex : null;
  }

  async submit(lotHash: Hex, payloadHash: Hex, uri: string): Promise<Hex> {
    const registry = await this.verifyNetwork();
    const { account, passwordFile, rpcUrl } = this.config;
    if (!account || !passwordFile || !existsSync(passwordFile)) {
      throw new ChainUnavailable('signer_unavailable');
    }

    // A wrong signer would waste gas on a revert. Check the immutable writer
    // address before invoking the keystore-backed cast command.
    const anchorerWord = await this.rpc<string>('eth_call', [{ to: registry, data: ANCHORER_SELECTOR }, 'latest']);
    const anchorer = `0x${anchorerWord.slice(-40)}`.toLowerCase();
    const args = [
      'wallet', 'address', '--account', account, '--password-file', passwordFile,
    ];
    let signerAddress: string;
    try {
      signerAddress = await this.runCast(args, rpcUrl);
    } catch {
      throw new ChainUnavailable('signer_unavailable');
    }
    if (signerAddress.trim().toLowerCase() !== anchorer) throw new ChainUnavailable('signer_unavailable');

    const output = await this.runCast([
      'send', '--async', registry,
      'anchor(bytes32,bytes32,string)', lotHash, payloadHash, uri,
      '--account', account, '--password-file', passwordFile,
      '--timeout', '45',
    ], rpcUrl);
    const txHash = output.trim();
    if (!HASH.test(txHash)) throw new ChainUnavailable('broadcast_failed');
    return txHash as Hex;
  }

  private async runCast(args: string[], rpcUrl: string | null): Promise<string> {
    if (!rpcUrl) throw new ChainUnavailable('rpc_unconfigured');
    try {
      const child = Bun.spawn(['cast', ...args], {
        env: { ...Bun.env, ETH_RPC_URL: rpcUrl },
        stdout: 'pipe',
        stderr: 'pipe',
      });
      const timer = setTimeout(() => child.kill(), 55_000);
      try {
        const [exitCode, stdout] = await Promise.all([
          child.exited,
          new Response(child.stdout).text(),
          new Response(child.stderr).text(),
        ]);
        if (exitCode !== 0) throw new ChainUnavailable('broadcast_failed');
        return stdout;
      } finally {
        clearTimeout(timer);
      }
    } catch {
      throw new ChainUnavailable('broadcast_failed');
    }
  }

  async receipt(txHash: Hex, lotHash: Hex, payloadHash: Hex): Promise<ReceiptResult> {
    const registry = await this.verifyNetwork();
    const receipt = await this.rpc<RpcReceipt | null>('eth_getTransactionReceipt', [txHash]);
    if (!receipt) return { state: 'waiting' };
    if (receipt.status !== '0x1') return { state: 'failed', reason: 'receipt_mismatch' };

    const anchored = receipt.logs.some((log) =>
      log.address.toLowerCase() === registry.toLowerCase()
      && log.topics[0]?.toLowerCase() === ANCHORED_TOPIC
      && log.topics[1]?.toLowerCase() === lotHash.toLowerCase()
      && `0x${log.data.slice(2, 66)}`.toLowerCase() === payloadHash.toLowerCase()
    );
    return anchored ? { state: 'confirmed' } : { state: 'failed', reason: 'receipt_mismatch' };
  }
}
