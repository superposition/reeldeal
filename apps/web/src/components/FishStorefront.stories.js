import FishStorefront from './FishStorefront.astro';

export default {
  title: 'ReelDeal/03 Organisms/Fish Storefront',
  component: FishStorefront,
  parameters: { layout: 'fullscreen' },
};

export const English = {};
export const Japanese = { args: { locale: 'ja' } };
