// Attach to an isolated headless Chrome CDP port, then inspect the real Astro
// island, service-worker isolation and (optionally) an actual Laya inference.
// Usage: RD_CDP_PORT=9223 node scripts/verify-model-browser.mjs [--model]
const port = process.env.RD_CDP_PORT ?? '9223';
const url = process.env.RD_MODEL_URL ?? 'http://127.0.0.1:4321/reeldeal/model/';
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
socket.addEventListener('message', ({ data }) => {
  const message = JSON.parse(data);
  if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.text);
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
async function poll(label, predicate, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const value = await evaluate('({ready:document.readyState,hydrated:document.querySelector("astro-island")?.hasAttribute("ssr")===false,isolated:crossOriginIsolated,status:document.querySelector(".model-lab__status")?.textContent,error:document.querySelector(".model-lab__error")?.textContent,result:document.querySelector(".model-lab__result")?.textContent,loadEnabled:!Array.from(document.querySelectorAll(".model-lab__actions button")).find(b=>b.textContent.includes("Download"))?.disabled})');
      if (predicate(value)) return value;
    } catch { /* navigation may temporarily destroy the execution context */ }
    await pause(500);
  }
  const diagnostics = await evaluate('(async()=>({url:location.href,isolated:crossOriginIsolated,controller:navigator.serviceWorker?.controller?.scriptURL,registrations:await navigator.serviceWorker?.getRegistrations().then(rs=>rs.map(r=>({scope:r.scope,active:r.active?.scriptURL}))),body:document.body.textContent.slice(0,300)}))()');
  throw new Error(`${label} timed out: ${JSON.stringify(diagnostics)}; errors: ${errors.join(' | ')}`);
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
    await evaluate('document.querySelector(".model-lab__actions button")?.click()');
    state = await poll('service-worker isolation', (value) => value.isolated && value.status, 30_000);
    console.log(JSON.stringify({ phase: 'isolated', ...state }));
  }
  await evaluate('Array.from(document.querySelectorAll(".model-lab__actions button")).find(b=>b.textContent.includes("rule-based"))?.click()');
  state = await poll('stub sample', (value) => value.result?.includes('reeldeal-stub'));
  console.log(JSON.stringify({ phase: 'stub', status: state.status, result: state.result }));
  if (process.argv.includes('--model')) {
    await poll('load button enabled', (value) => value.loadEnabled);
    await evaluate('Array.from(document.querySelectorAll(".model-lab__actions button")).find(b=>b.textContent.includes("Download"))?.click()');
    let lastStatus = '';
    const deadline = Date.now() + 12 * 60_000;
    while (Date.now() < deadline) {
      state = await evaluate('({status:document.querySelector(".model-lab__status")?.textContent,error:document.querySelector(".model-lab__error")?.textContent})');
      if (state.status !== lastStatus && state.status) {
        console.log(JSON.stringify({ phase: 'load', ...state }));
        lastStatus = state.status;
      }
      if (state.error) throw new Error(state.error);
      if (state.status?.startsWith('Laya ready')) break;
      await pause(1000);
    }
    if (!state.status?.startsWith('Laya ready')) throw new Error('Laya load timed out');
    await evaluate('Array.from(document.querySelectorAll(".model-lab__actions button")).find(b=>b.textContent.includes("Run Laya"))?.click()');
    state = await poll('Laya sample', (value) => value.result?.includes('laya-typed-decisions') || value.error, 120_000);
    if (state.error) throw new Error(state.error);
    console.log(JSON.stringify({ phase: 'laya', ...state }));
  }
  if (errors.length) throw new Error(`Browser console/runtime errors: ${errors.join(' | ')}`);
  console.log('Browser verification passed');
} finally {
  socket.close();
}
