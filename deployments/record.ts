import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const [chainText, registryAddress, listingBookAddress, deployer, blockText] = Bun.argv.slice(2);
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const chainId = Number(chainText);
const deploymentBlock = Number(blockText);
const rpcUrl = process.env.REELDEAL_RPC_URL;

if (!Number.isSafeInteger(chainId) || chainId <= 0
  || !Number.isSafeInteger(deploymentBlock) || deploymentBlock < 0
  || !registryAddress || !ADDRESS.test(registryAddress)
  || !listingBookAddress || !ADDRESS.test(listingBookAddress)
  || !deployer || !ADDRESS.test(deployer)
  || !rpcUrl) {
  throw new Error('Usage: REELDEAL_RPC_URL=<url> bun deployments/record.ts <chain-id> <registry> <book> <deployer> <block>');
}

async function rpc<T>(method: string, params: unknown[]): Promise<T> {
  const response = await fetch(rpcUrl!, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw new Error(`RPC call ${method} failed`);
  const body = await response.json() as { result?: T; error?: unknown };
  if (body.error || body.result === undefined) throw new Error(`RPC call ${method} failed`);
  return body.result;
}

const actualChainId = Number.parseInt(await rpc<string>('eth_chainId', []), 16);
if (actualChainId !== chainId) throw new Error('RPC chain ID does not match requested chain');
for (const address of [registryAddress, listingBookAddress]) {
  const code = await rpc<string>('eth_getCode', [address, 'latest']);
  if (!code || code === '0x') throw new Error('Contract code missing at supplied address');
}
const anchorerWord = await rpc<string>('eth_call', [
  { to: registryAddress, data: '0x84609921' }, 'latest',
]);
if (`0x${anchorerWord.slice(-40)}`.toLowerCase() !== deployer.toLowerCase()) {
  throw new Error('Registry anchorer does not match deployer');
}

const path = resolve(import.meta.dir, `${chainId}.json`);
const manifest = {
  chainId, registryAddress, listingBookAddress, deployer, deploymentBlock,
  verifiedAt: new Date().toISOString(),
};
writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' });
console.log(`Verified deployment recorded at ${path}`);
