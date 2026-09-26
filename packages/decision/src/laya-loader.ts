import { LAYA_MODEL } from './laya-lock';

export type ModelPin = {
  base: string;
  variant: string;
  manifestVersion: number;
  chunkBytes: number;
  graph: string;
  graphBytes: number;
  graphSha256: string;
  assetHashes: { manifest: string; tokenizer: string; tokenizerConfig: string; config: string };
  weights: { name: string; bytes: number; sha256: string; parts: number };
  maxLen: number;
  headMaxLen: number;
};

export type ModelProgress = {
  phase: 'manifest' | 'graph' | 'weights' | 'cache' | 'tokenizer' | 'session' | 'ready';
  loaded?: number;
  total?: number;
  detail?: string;
};

type Variant = {
  onnx: string;
  data: { name: string; size: number; sha256: string; parts: string[] };
};

const hex = (bytes: Uint8Array) => Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');

export async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
  return hex(new Uint8Array(digest));
}

export function validateManifest(raw: unknown, pin: ModelPin = LAYA_MODEL): Variant {
  if (!raw || typeof raw !== 'object') throw new Error('Laya manifest is not an object');
  const manifest = raw as Record<string, unknown>;
  if (manifest.version !== pin.manifestVersion || manifest.chunk_bytes !== pin.chunkBytes) {
    throw new Error('Laya manifest version or chunk size differs from the reviewed pin');
  }
  const variants = manifest.variants as Record<string, Variant> | undefined;
  const variant = variants?.[pin.variant];
  if (!variant || variant.onnx !== pin.graph || variant.data?.name !== pin.weights.name ||
      variant.data.size !== pin.weights.bytes || variant.data.sha256 !== pin.weights.sha256 ||
      !Array.isArray(variant.data.parts) || variant.data.parts.length !== pin.weights.parts) {
    throw new Error('Laya variant differs from the reviewed pin');
  }
  for (let i = 0; i < variant.data.parts.length; i++) {
    const expected = `${pin.weights.name}.part${String(i).padStart(3, '0')}`;
    if (variant.data.parts[i] !== expected) throw new Error(`unexpected Laya part ${i}`);
  }
  return variant;
}

type Fetcher = typeof fetch;
const emit = (callback: ((progress: ModelProgress) => void) | undefined, progress: ModelProgress) => callback?.(progress);

async function fetchBytes(url: string, fetcher: Fetcher, onChunk?: (bytes: number) => void): Promise<Uint8Array> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120_000);
    try {
      const response = await fetcher(url, { signal: controller.signal, mode: 'cors' });
      if (!response.ok) throw new Error(`${new URL(url).pathname}: HTTP ${response.status}`);
      if (!response.body) {
        const bytes = new Uint8Array(await response.arrayBuffer());
        onChunk?.(bytes.length);
        return bytes;
      }
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let length = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        length += value.length;
        onChunk?.(length);
      }
      const output = new Uint8Array(length);
      let offset = 0;
      for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.length; }
      return output;
    } catch (error) {
      lastError = error;
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
    } finally {
      clearTimeout(timeout);
    }
  }
  throw new Error(`Laya fetch failed after 3 attempts: ${String(lastError)}`);
}

const parseJson = (bytes: Uint8Array): unknown => JSON.parse(new TextDecoder().decode(bytes));

export async function assemblePinnedWeights(
  variant: Variant,
  pin: ModelPin = LAYA_MODEL,
  onProgress?: (progress: ModelProgress) => void,
  fetcher: Fetcher = fetch,
): Promise<Uint8Array> {
  const output = new Uint8Array(pin.weights.bytes);
  let offset = 0;
  for (let i = 0; i < variant.data.parts.length; i++) {
    const name = variant.data.parts[i];
    const expected = Math.min(pin.chunkBytes, pin.weights.bytes - offset);
    const bytes = await fetchBytes(new URL(name, pin.base).href, fetcher, (loaded) => {
      emit(onProgress, { phase: 'weights', loaded: offset + loaded, total: pin.weights.bytes, detail: name });
    });
    if (bytes.length !== expected) throw new Error(`Laya ${name}: expected ${expected} bytes, got ${bytes.length}`);
    output.set(bytes, offset);
    offset += bytes.length;
    emit(onProgress, { phase: 'weights', loaded: offset, total: pin.weights.bytes, detail: name });
  }
  if (offset !== pin.weights.bytes) throw new Error('Laya weights incomplete');
  const digest = await sha256(output);
  if (digest !== pin.weights.sha256) throw new Error('Laya weights SHA-256 differs from the reviewed pin');
  return output;
}

export type PinnedAssets = {
  graph: Uint8Array;
  weights: Uint8Array;
  tokenizer: object;
  tokenizerConfig: object;
  config: Record<string, unknown>;
  fromCache: boolean;
};

export async function loadPinnedAssets(
  onProgress?: (progress: ModelProgress) => void,
  options: { pin?: ModelPin; fetcher?: Fetcher; cacheStorage?: CacheStorage | null } = {},
): Promise<PinnedAssets> {
  const pin = options.pin ?? LAYA_MODEL;
  const fetcher = options.fetcher ?? fetch;
  const cacheStorage = options.cacheStorage === undefined
    ? (typeof caches === 'undefined' ? null : caches)
    : options.cacheStorage;
  let cache: Cache | null = null;
  try { cache = await cacheStorage?.open(`reeldeal-laya-${pin.variant}-${pin.weights.sha256}`) ?? null; }
  catch { /* private browsing or quota limits: use network */ }
  const cacheKey = (name: string, digest: string) => {
    const url = new URL(name, pin.base);
    url.searchParams.set('sha256', digest);
    return url.href;
  };
  const cachedBytes = async (key: string, length?: number): Promise<Uint8Array | null> => {
    try {
      const cached = await cache?.match(key);
      if (!cached) return null;
      const bytes = new Uint8Array(await cached.arrayBuffer());
      if (length !== undefined && bytes.length !== length) return null;
      const expected = new URL(key).searchParams.get('sha256');
      return expected && await sha256(bytes) === expected ? bytes : null;
    } catch { return null; }
  };
  const verifiedAsset = async (name: string, digest: string, length?: number) => {
    const key = cacheKey(name, digest);
    const cached = await cachedBytes(key, length);
    if (cached) return cached;
    const bytes = await fetchBytes(new URL(name, pin.base).href, fetcher);
    if ((length !== undefined && bytes.length !== length) || await sha256(bytes) !== digest) {
      throw new Error(`Laya ${name} differs from the reviewed pin`);
    }
    try { await cache?.put(key, new Response(bytes.buffer as ArrayBuffer)); }
    catch { /* cache quota limits are non-fatal */ }
    return bytes;
  };
  emit(onProgress, { phase: 'manifest' });
  const manifest = parseJson(await verifiedAsset('manifest.json', pin.assetHashes.manifest));
  const variant = validateManifest(manifest, pin);

  emit(onProgress, { phase: 'graph' });
  const graph = await verifiedAsset(pin.graph, pin.graphSha256, pin.graphBytes);

  emit(onProgress, { phase: 'tokenizer' });
  const [tokenizer, tokenizerConfig, config] = await Promise.all([
    verifiedAsset('tokenizer.json', pin.assetHashes.tokenizer).then(parseJson),
    verifiedAsset('tokenizer_config.json', pin.assetHashes.tokenizerConfig).then(parseJson),
    verifiedAsset('rl_agent_config.json', pin.assetHashes.config).then(parseJson),
  ]);
  const cfg = config as Record<string, unknown>;
  if (cfg.max_len !== pin.maxLen || cfg.head_max_len !== pin.headMaxLen) {
    throw new Error('Laya sequence limits differ from the reviewed pin');
  }

  const weightsKey = cacheKey(pin.weights.name, pin.weights.sha256);
  let weights: Uint8Array | null = null;
  let fromCache = false;
  try {
    const cached = await cachedBytes(weightsKey, pin.weights.bytes);
    if (cached) {
      emit(onProgress, { phase: 'cache', loaded: 0, total: pin.weights.bytes });
      weights = cached;
      fromCache = true;
      emit(onProgress, { phase: 'cache', loaded: cached.length, total: cached.length });
    }
  } catch { /* corrupt or unavailable cache: verify a fresh download */ }
  if (!weights) {
    weights = await assemblePinnedWeights(variant, pin, onProgress, fetcher);
    try { await cache?.put(weightsKey, new Response(weights.buffer as ArrayBuffer)); }
    catch { /* quota limits are non-fatal; this load remains verified */ }
  }
  return {
    graph, weights, tokenizer: tokenizer as object,
    tokenizerConfig: tokenizerConfig as object, config: cfg, fromCache,
  };
}
