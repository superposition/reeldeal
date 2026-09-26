// Attach to an isolated headless Chrome CDP port, then inspect the real Astro
// island, service-worker isolation and (optionally) an actual Laya inference.
// Usage:
//   RD_CDP_PORT=9223 node scripts/verify-model-browser.mjs [--model] [--single-thread]
//   RD_CDP_PORT=9223 node scripts/verify-model-browser.mjs --offline-reload
//
// --offline-reload proves the Cache Storage claim on a cold profile: the first
// load is a verified download, the weights host is then cut at the network
// layer (with a control fetch showing the cut is real), and a page reload into
// a fresh JS context must load the same pinned artifact and answer a sample
// without a single request to that host.
const port = process.env.RD_CDP_PORT ?? '9223';
const url = process.env.RD_MODEL_URL ?? 'http://127.0.0.1:4321/reeldeal/model/';
const pinnedBase = 'https://huggingface.co/VishalMysore/layaForWebTrained/resolve/dd0c52a2b563bea25279e2689689061dd0a1c382/';
const weightsSha256 = 'de4960a6ee6f39e7eed4c5781cd9694faf1f99fc95bd6953ca8aa14a6ffb055b';
const weightsBytes = 291_127_040;
const weightsHosts = /huggingface\.co|hf\.co|cdn-lfs/;
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const targetResponse = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' });
if (!targetResponse.ok) throw new Error(`CDP target: ${targetResponse.status}`);
const target = await targetResponse.json();
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true });
  socket.addEventListener('error', reject, { once: true });
});
let sequence = 0;
const pending = new Map();
const errors = [];
const requests = [];
socket.addEventListener('message', ({ data }) => {
  const message = JSON.parse(data);
  if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.text);
  if (message.method === 'Network.requestWillBeSent') requests.push(message.params.request.url);
  if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
    errors.push(message.params.args.map((arg) => arg.value ?? arg.description).join(' '));
  }
  if (!message.id) return;
  const task = pending.get(message.id);
  if (!task) return;
  pending.delete(message.id);
  if (message.error) task.reject(new Error(message.error.message));
  else task.resolve(message.result);
});
function cdp(method, params = {}) {
  const id = ++sequence;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const response = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.text);
  return response.result.value;
}
const labState = '({ready:document.readyState,hydrated:document.querySelector("astro-island")?.hasAttribute("ssr")===false,isolated:crossOriginIsolated,status:document.querySelector(".model-lab__status")?.textContent,error:document.querySelector(".model-lab__error")?.textContent,result:document.querySelector(".model-lab__result")?.textContent,loadEnabled:!Array.from(document.querySelectorAll(".model-lab__actions button")).find(b=>b.textContent.includes("Download"))?.disabled})';
const clickButton = (label) => evaluate(`Array.from(document.querySelectorAll(".model-lab__actions button")).find(b=>b.textContent.includes(${JSON.stringify(label)}))?.click()`);
async function poll(label, predicate, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const value = await evaluate(labState);
      if (predicate(value)) return value;
    } catch { /* navigation may temporarily destroy the execution context */ }
    await pause(500);
  }
  const diagnostics = await evaluate('(async()=>({url:location.href,isolated:crossOriginIsolated,controller:navigator.serviceWorker?.controller?.scriptURL,registrations:await navigator.serviceWorker?.getRegistrations().then(rs=>rs.map(r=>({scope:r.scope,active:r.active?.scriptURL}))),body:document.body.textContent.slice(0,300)}))()');
  throw new Error(`${label} timed out: ${JSON.stringify(diagnostics)}; errors: ${errors.join(' | ')}`);
}
async function loadUntilReady(timeoutMs = 12 * 60_000) {
  await clickButton('Download');
  let lastStatus = '';
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const state = await evaluate('({status:document.querySelector(".model-lab__status")?.textContent,error:document.querySelector(".model-lab__error")?.textContent})');
    if (state.status !== lastStatus && state.status) {
      console.log(JSON.stringify({ phase: 'load', ...state }));
      lastStatus = state.status;
    }
    if (state.error) throw new Error(state.error);
    if (state.status?.startsWith('Laya ready')) return state;
    await pause(1000);
  }
  throw new Error('Laya load timed out');
}
async function runSample() {
  await clickButton('Run Laya');
  const state = await poll('Laya sample', (value) => value.result?.includes('laya-typed-decisions') || value.error, 120_000);
  if (state.error) throw new Error(state.error);
  return state;
}
async function cacheEvidence() {
  return evaluate(`(async()=>{
    const names = await caches.keys();
    const target = names.find((name) => name.startsWith('reeldeal-laya-'));
    if (!target) return { names, target: null, entries: [] };
    const cache = await caches.open(target);
    const entries = [];
    for (const request of await cache.keys()) {
      const response = await cache.match(request);
      entries.push({ url: request.url, bytes: response ? (await response.arrayBuffer()).byteLength : null });
    }
    return { names, target, entries };
  })()`);
}
async function runOfflineReload() {
  await cdp('Network.enable');
  // 1. Cold profile: the first load is a real verified download that fills Cache Storage.
  await poll('download button', (value) => value.loadEnabled);
  const first = await loadUntilReady();
  console.log(JSON.stringify({ phase: 'first-load', status: first.status }));
  if (!first.status.includes('verified download')) throw new Error(`expected a verified download first, got: ${first.status}`);
  const filled = await cacheEvidence();
  console.log(JSON.stringify({ phase: 'cache-after-download', ...filled }));
  const weights = filled.entries.find((entry) => entry.url.includes('laya_q4e8.onnx.data'));
  if (!weights) throw new Error('the assembled weights are not in Cache Storage');
  if (weights.bytes !== weightsBytes) throw new Error(`cached weights are ${weights.bytes} bytes, expected ${weightsBytes}`);
  if (!weights.url.includes(`sha256=${weightsSha256}`)) throw new Error(`the weights cache key does not pin the digest: ${weights.url}`);

  // 2. Cut the weights host and prove the cut, so a successful load can only be local.
  await cdp('Network.setBlockedURLs', { urls: ['*huggingface.co*', '*hf.co*', '*cdn-lfs*'] });
  const control = await evaluate(`fetch(${JSON.stringify(`${pinnedBase}manifest.json`)}, { cache: 'reload' }).then(() => 'reached the network').catch((error) => 'blocked: ' + error)`);
  console.log(JSON.stringify({ phase: 'control-fetch', control }));
  if (!String(control).startsWith('blocked')) throw new Error(`the weights host is still reachable from the page: ${control}`);

  // 3. Reload into a fresh JS context: no worker, no in-memory weights, cold module state.
  const mark = requests.length;
  await evaluate('location.reload()');
  let state = await poll('cold reload', (value) => value.hydrated && value.isolated && value.status, 60_000);
  console.log(JSON.stringify({ phase: 'reloaded', status: state.status, isolated: state.isolated }));
  state = await loadUntilReady();
  if (!state.status.includes('verified cache')) throw new Error(`the reload did not reuse the cache: ${state.status}`);
  console.log(JSON.stringify({ phase: 'cached-load', status: state.status }));

  // 4. Answer a sample from the cached artifact and confirm nothing asked the network for it.
  const inferred = await runSample();
  console.log(JSON.stringify({ phase: 'cached-inference', result: inferred.result }));
  const offlineRequests = requests.slice(mark);
  const modelRequests = offlineRequests.filter((request) => weightsHosts.test(request));
  console.log(JSON.stringify({ phase: 'reload-requests', total: offlineRequests.length, weightsHost: modelRequests.length }));
  if (modelRequests.length) throw new Error(`the reload still contacted the weights host: ${modelRequests.join(', ')}`);
  const after = await cacheEvidence();
  const cachedWeights = after.entries.find((entry) => entry.url.includes('laya_q4e8.onnx.data'));
  if (cachedWeights?.bytes !== weightsBytes || after.target !== filled.target) throw new Error('the cache entry changed across the reload');
  console.log(JSON.stringify({ phase: 'cache-after-reload', target: after.target, entries: after.entries.length, weightsBytes: cachedWeights.bytes }));
}
try {
  await cdp('Runtime.enable');
  await cdp('Page.enable');
  let state = await poll('ModelLab hydration', (value) => value.status && value.hydrated);
  console.log(JSON.stringify({ phase: 'initial', ...state }));
  if (process.argv.includes('--single-thread') && state.isolated) {
    await evaluate('(async()=>{for(const registration of await navigator.serviceWorker.getRegistrations()) await registration.unregister(); location.reload()})()');
    state = await poll('one-thread page reload', (value) => !value.isolated && value.hydrated && value.status);
    console.log(JSON.stringify({ phase: 'one-thread', ...state }));
  } else if (!state.isolated && !process.argv.includes('--single-thread')) {
    await clickButton('Enable threads');
    state = await poll('service-worker isolation', (value) => value.isolated && value.status, 30_000);
    console.log(JSON.stringify({ phase: 'isolated', ...state }));
  }
  if (process.argv.includes('--offline-reload')) {
    await runOfflineReload();
  } else {
    await clickButton('rule-based');
    state = await poll('stub sample', (value) => value.result?.includes('reeldeal-stub'));
    console.log(JSON.stringify({ phase: 'stub', status: state.status, result: state.result }));
    if (process.argv.includes('--model')) {
      await poll('load button enabled', (value) => value.loadEnabled);
      state = await loadUntilReady();
      const inferred = await runSample();
      console.log(JSON.stringify({ phase: 'laya', status: state.status, result: inferred.result }));
    }
  }
  if (errors.length) throw new Error(`Browser console/runtime errors: ${errors.join(' | ')}`);
  console.log('Browser verification passed');
} finally {
  socket.close();
}
