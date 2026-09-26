import MarketCard from './MarketCard.astro';
import { previewLots } from '../data/preview-lots';

export default {
  title: 'ReelDeal/02 Molecules/Market Card',
  component: MarketCard,
  args: { lot: previewLots[0], base: '/reeldeal/', first: true, index: 0 },
  parameters: { layout: 'centered' },
};

export const Katsuo = {};
export const Sanma = { args: { lot: previewLots[1], first: false, index: 1 } };
export const Saba = { args: { lot: previewLots[2], first: false, index: 2 } };
