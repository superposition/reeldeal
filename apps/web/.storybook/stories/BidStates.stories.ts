import BidStatesShowcase from './BidStatesShowcase.astro';
import '../../src/components/BidPanel.css';

export default {
  title: 'ReelDeal/03 Organisms/Bid States',
  component: BidStatesShowcase,
  parameters: {
    layout: 'fullscreen',
    docs: { description: { component: 'Static visual references only. No wallet connection, signature, or market write occurs in these stories.' } },
  },
};

export const ClosedAction = { args: { state: 'closed' } };
export const OfferFormNoWallet = { args: { state: 'offer' } };
export const WalletCancelled = { args: { state: 'cancelled' } };
export const OfferReceived = { args: { state: 'received' } };
export const BiddingClosed = { args: { state: 'bidding_closed' } };
