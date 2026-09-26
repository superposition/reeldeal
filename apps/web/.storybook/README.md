# ReelDeal Storybook

Run `bun run --cwd apps/web storybook` from the repository root. It builds and serves the component workshop at `http://localhost:6007/`. Stop it with Ctrl-C; rerun after source changes. `bun run --cwd apps/web build-storybook` only builds the static files.

The stories import ReelDeal's actual Astro components and pages. The hierarchy is atoms (Button, Badge, ActionTile), molecule (MarketCard), and organisms (Shop and Lot Detail). The Shop organism shows the honest preview fallback; the Lot Detail organism shows its loading shell because no API fixture is injected.

Astro support is community-maintained. The static build pre-renders Astro stories, so Controls do not change their args after build. Live dev rendering currently times out in this setup; the supported command above serves the built Storybook. The preview stylesheet uses ReelDeal's own placeholder image as a visual fallback because the Astro story renderer leaves `<Picture>` URLs pointing at a dev-only `/@fs/` path in static stories. The production image/component code is unchanged.
