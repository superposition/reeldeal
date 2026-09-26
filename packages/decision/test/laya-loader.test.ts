import { expect, test } from 'bun:test';
import {
  assemblePinnedWeights, loadPinnedAssets, sha256, validateManifest,
  type ModelPin,
} from '../src/laya-loader';

const bytes = (text: string) => new TextEncoder().encode(text);

async function fixture() {
  const manifest = {
    version: 1, chunk_bytes: 3,
    variants: { q4e8: { onnx: 'graph.onnx', data: {
      name: 'weights.data', size: 6, sha256: await sha256(bytes('abcdef')),
      parts: ['weights.data.part000', 'weights.data.part001'],
    } } },
  };
  const pin: ModelPin = {
    base: 'https://example.test/model/', variant: 'q4e8', manifestVersion: 1,
    chunkBytes: 3, graph: 'graph.onnx', graphBytes: 5,
    graphSha256: await sha256(bytes('graph')),
    weights: { name: 'weights.data', bytes: 6, sha256: await sha256(bytes('abcdef')), parts: 2 },
    assetHashes: {
      manifest: await sha256(bytes(JSON.stringify(manifest))),
      tokenizer: await sha256(bytes('{}')),
      tokenizerConfig: await sha256(bytes('{}')),
      config: await sha256(bytes('{"max_len":1024,"head_max_len":256}')),
    },
    maxLen: 1024, headMaxLen: 256,
  };
  return { pin, manifest };
}

test('manifest is checked against the reviewed pin, not trusted on its own', async () => {
  const { pin, manifest } = await fixture();
  expect(validateManifest(manifest, pin).data.size).toBe(6);
  expect(() => validateManifest({ ...manifest, chunk_bytes: 4 }, pin)).toThrow('reviewed pin');
  expect(() => validateManifest({ ...manifest, variants: { q4e8: {
    ...manifest.variants.q4e8,
    data: { ...manifest.variants.q4e8.data, sha256: 'attacker-controlled' },
  } } }, pin)).toThrow('reviewed pin');
});

test('parts have exact lengths and assembled bytes must match pinned SHA-256', async () => {
  const { pin, manifest } = await fixture();
  const variant = validateManifest(manifest, pin);
  const goodFetch = (async (input: RequestInfo | URL) => new Response(bytes(String(input).endsWith('000') ? 'abc' : 'def'))) as typeof fetch;
  expect(new TextDecoder().decode(await assemblePinnedWeights(variant, pin, undefined, goodFetch))).toBe('abcdef');

  const shortFetch = (async (input: RequestInfo | URL) => new Response(bytes(String(input).endsWith('000') ? 'ab' : 'def'))) as typeof fetch;
  await expect(assemblePinnedWeights(variant, pin, undefined, shortFetch)).rejects.toThrow('expected 3 bytes');

  const driftFetch = (async (input: RequestInfo | URL) => new Response(bytes(String(input).endsWith('000') ? 'abc' : 'xyz'))) as typeof fetch;
  await expect(assemblePinnedWeights(variant, pin, undefined, driftFetch)).rejects.toThrow('SHA-256');
});

test('verified assembled weights are reused from digest-keyed Cache Storage', async () => {
  const { pin, manifest } = await fixture();
  const cache = new Map<string, Response>();
  const cacheStorage = {
    async open(name: string) {
      expect(name).toContain(pin.weights.sha256);
      return {
        async match(key: string) { return cache.get(key)?.clone(); },
        async put(key: string, response: Response) { cache.set(key, response.clone()); },
      };
    },
  } as CacheStorage;
  let partFetches = 0;
  const fetcher = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith('manifest.json')) return Response.json(manifest);
    if (url.endsWith('graph.onnx')) return new Response(bytes('graph'));
    if (url.endsWith('rl_agent_config.json')) return Response.json({ max_len: 1024, head_max_len: 256 });
    if (url.endsWith('tokenizer.json') || url.endsWith('tokenizer_config.json')) return Response.json({});
    partFetches++;
    return new Response(bytes(url.endsWith('000') ? 'abc' : 'def'));
  }) as typeof fetch;
  const first = await loadPinnedAssets(undefined, { pin, fetcher, cacheStorage });
  expect(first.fromCache).toBe(false);
  expect(partFetches).toBe(2);
  const second = await loadPinnedAssets(undefined, { pin, fetcher, cacheStorage });
  expect(second.fromCache).toBe(true);
  expect(partFetches).toBe(2);

  const offline = (async () => { throw new Error('network unavailable'); }) as unknown as typeof fetch;
  const third = await loadPinnedAssets(undefined, { pin, fetcher: offline, cacheStorage });
  expect(third.fromCache).toBe(true);
  expect(new TextDecoder().decode(third.weights)).toBe('abcdef');
});
