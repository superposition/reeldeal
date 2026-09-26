import { readFile, writeFile, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

// Astro's static story renderer keeps source-image URLs from its dev server.
// Point those images at the assets already copied by Storybook's staticDirs.
const output = new URL('../apps/web/storybook-static/', import.meta.url);
const assets = fileURLToPath(new URL('../apps/web/src/assets/', import.meta.url));
const payload = new URL('astro-prerendered-stories.json', output);
const stories = JSON.parse(await readFile(payload, 'utf8'));
for (const [id, html] of Object.entries(stories)) {
  const images = [...html.matchAll(/src="(\/@fs\/[^"?]+)(?:\?[^\"]*)?"/g)];
  let rendered = html;
  for (const [attribute, source] of images) {
    const path = source.slice('/@fs'.length).replace(/^\/\//, '/');
    if (!path.startsWith(assets)) continue;
    const relative = path.slice(assets.length);
    await access(new URL(`story-assets/${relative}`, output));
    rendered = rendered.replace(attribute, `src="/story-assets/${relative}"`);
  }
  stories[id] = rendered;
}
await writeFile(payload, JSON.stringify(stories));
console.log(`Prepared images for ${Object.keys(stories).length} static Astro stories.`);
