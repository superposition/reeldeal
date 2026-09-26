// Copy the exact local WASM build into Astro public assets. No CDN or model
// service is needed for runtime code; the large open weights stay on HF.
import { copyFileSync, mkdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const app = join(root, 'apps/web');
const requireFromWeb = createRequire(pathToFileURL(join(app, 'package.json')));
const ortDist = dirname(requireFromWeb.resolve('onnxruntime-web/wasm'));
const destination = join(app, 'public/vendor');
mkdirSync(destination, { recursive: true });

for (const name of ['ort-wasm-simd-threaded.mjs', 'ort-wasm-simd-threaded.wasm']) {
  const source = join(ortDist, name);
  if (statSync(source).size === 0) throw new Error(`empty ONNX runtime asset: ${name}`);
  copyFileSync(source, join(destination, name));
}

for (const [source, name] of [
  ['packages/decision/vendor/laya/LICENSE', 'laya-LICENSE.txt'],
  ['packages/decision/vendor/laya/NOTICE.md', 'laya-NOTICE.txt'],
  ['packages/decision/vendor/laya/licenses/onnxruntime-LICENSE.txt', 'onnxruntime-LICENSE.txt'],
  ['packages/decision/vendor/laya/licenses/onnxruntime-ThirdPartyNotices.txt', 'onnxruntime-ThirdPartyNotices.txt'],
  ['packages/decision/vendor/laya/licenses/tokenizers.js-LICENSE.txt', 'tokenizers-LICENSE.txt'],
]) copyFileSync(join(root, source), join(destination, name));

console.log('Laya WASM runtime and notices ready in apps/web/public/vendor/');
