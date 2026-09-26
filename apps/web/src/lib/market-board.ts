import { marketCopy } from '../data/market-copy';

type Listing = {
  id: string; lot_id: string; status: string; species_label: string | null;
  weight_g: number | null; length_mm: number | null; price_jpy: number;
  captured_at: string; image_ref: string | null; demo: boolean;
};

const market = document.querySelector<HTMLElement>('[data-market]');
if (market) {
  const locale = market.dataset.locale === 'ja' ? 'ja' : 'en';
  const t = marketCopy[locale];
  const images = JSON.parse(market.dataset.fishImages ?? '{}') as Record<string, string>;
  const names = JSON.parse(market.dataset.fishNames ?? '{}') as Record<string, string>;
  const status = market.querySelector<HTMLElement>('[data-market-status]');
  const count = document.querySelector<HTMLElement>('[data-live-count]');
  const live = market.querySelector<HTMLElement>('[data-live-grid]');
  const preview = market.querySelector<HTMLElement>('[data-preview-grid]');
  const empty = market.querySelector<HTMLElement>('[data-market-empty]');
  const api = (market.dataset.apiOrigin ?? '').replace(/\/$/, '');
  const base = market.dataset.base ?? '/';
  const art = market.dataset.placeholder ?? '';
  const params = new URLSearchParams(location.search);
  const selectedStatus = params.get('status') ?? 'open';
  const selectedCategory = params.get('category') ?? 'all';

  for (const chip of market.querySelectorAll<HTMLAnchorElement>('[data-filter-kind]')) {
    const kind = chip.dataset.filterKind!;
    const value = chip.dataset.filterValue!;
    const link = new URL(location.href);
    if (value === 'all' && kind === 'category') link.searchParams.delete(kind);
    else link.searchParams.set(kind, value);
    chip.href = `${link.pathname}${link.search}`;
    chip.setAttribute('aria-current', (kind === 'status' ? selectedStatus : selectedCategory) === value ? 'true' : 'false');
  }
  for (const link of document.querySelectorAll<HTMLAnchorElement>('.market-language a')) link.search = location.search;
  const previews = preview?.querySelectorAll<HTMLElement>('[data-species]') ?? [];
  for (const card of previews) card.hidden = selectedCategory !== 'all' && card.dataset.species !== selectedCategory;
  if (empty) empty.hidden = [...previews].some((card) => !card.hidden);

  function element<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, value?: string): HTMLElementTagNameMap[K] {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (value !== undefined) node.textContent = value;
    return node;
  }

  function card(listing: Listing, first: boolean, index: number): HTMLElement {
    const tones = ['lime', 'pink', 'yellow', 'blue'];
    const tone = listing.status === 'settled' ? 'pink' : tones[index % tones.length];
    const article = element('article', `market-card market-card--${tone}`);
    const imageWrap = element('div', 'market-card__media');
    const image = element('img');
    const species = (listing.species_label ?? '').toLowerCase();
    image.src = listing.image_ref ?? images[species] ?? art;
    image.alt = listing.image_ref ? t.photoAlt : t.referenceAlt;
    if (!listing.image_ref) article.classList.add('market-card--reference');
    image.width = 480;
    image.height = 360;
    image.loading = first ? 'eager' : 'lazy';
    imageWrap.append(image);
    const copy = element('div', 'market-card__image-copy');
    const availability = ({ open: t.open, accepted: t.accepted, settled: t.settled, cancelled: t.cancelled } as Record<string, string>)[listing.status]
      ?? listing.status;
    const badge = element('span', `rd-ui-badge rd-ui-badge--${listing.status === 'settled' ? 'pink' : 'lime'} market-card__status`);
    badge.append(element('span', 'rd-ui-badge__dot'), element('strong', undefined, listing.demo ? `${availability} ${t.demo}` : availability));
    const factsCopy = element('div', 'market-card__image-facts');
    const title = element('h2', undefined, names[species] ?? listing.species_label ?? t.unknown);
    const weight = listing.weight_g === null ? t.weightUnknown : `${listing.weight_g.toLocaleString('ja-JP')} g`;
    const length = listing.length_mm === null ? t.lengthUnknown : `${listing.length_mm} mm`;
    const facts = element('p');
    facts.append(element('span', undefined, weight), element('span', 'market-card__fact-divider', ' · '), element('span', undefined, length));
    const landed = element('small', undefined, `${t.landed} ${new Date(listing.captured_at).toLocaleString(locale === 'ja' ? 'ja-JP' : 'en-GB', {
      month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
    })}`);
    factsCopy.append(title, facts, landed);
    if (!listing.image_ref) factsCopy.append(element('small', undefined, t.sample));
    copy.append(badge, factsCopy);
    imageWrap.append(copy);
    const foot = element('div', 'market-card__foot');
    foot.append(element('strong', undefined, `¥${listing.price_jpy.toLocaleString('ja-JP')}`));
    const link = element('a', 'rd-ui-button rd-ui-button--ink rd-ui-button--secondary market-card__action', t.view);
    link.href = `${base}shop/lot/?id=${encodeURIComponent(listing.lot_id)}`;
    foot.append(link);
    article.append(imageWrap, foot);
    return article;
  }

  if (!api) {
    if (status) status.textContent = t.preview;
  } else {
    if (status) status.textContent = t.loading;
    const endpoint = new URL(`${api}/v1/listings`);
    if (selectedStatus !== 'all') endpoint.searchParams.set('status', selectedStatus);
    if (selectedCategory !== 'all') endpoint.searchParams.set('category', selectedCategory);
    void fetch(endpoint, { signal: AbortSignal.timeout(12_000) })
      .then(async (response) => {
        if (!response.ok) throw new Error(`${t.unavailable} (${response.status})`);
        return response.json() as Promise<{ listings: Listing[]; open_count: number }>;
      })
      .then(({ listings, open_count }) => {
        if (!live || !preview || !empty) return;
        const fragment = document.createDocumentFragment();
        listings.forEach((listing, index) => fragment.append(card(listing, index === 0, index)));
        live.replaceChildren(fragment);
        live.hidden = listings.length === 0;
        empty.hidden = listings.length !== 0;
        preview.hidden = true;
        if (count) count.textContent = `${open_count} ${t.openCount}`;
        if (status) status.textContent = '';
      })
      .catch((error) => {
        if (status) {
          status.dataset.error = 'true';
          status.textContent = `${error instanceof Error ? error.message : t.unavailable} ${t.fallback}`;
        }
      });
  }
}
