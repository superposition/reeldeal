import { defineConfig } from 'astro/config';
import solid from '@astrojs/solid-js';

export default defineConfig({
  output: 'static',
  site: 'https://superposition.github.io',
  base: '/reeldeal',
  integrations: [solid()],
});
