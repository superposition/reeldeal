import Badge from './Badge.astro';

export default {
  title: 'ReelDeal/01 Atoms/Badge',
  component: Badge,
  args: { label: 'Observed', tone: 'blue' },
  argTypes: {
    tone: { control: 'select', options: ['blue', 'pink', 'yellow', 'lime', 'green', 'ink'] },
  },
};

export const Observed = {};
export const PendingReview = { args: { label: 'Pending review', detail: 'Human check required', tone: 'pink' } };
export const Approved = { args: { label: 'Approved', detail: 'Ready for listing', tone: 'green' } };
export const Listed = { args: { label: 'Listed', tone: 'lime' } };
export const Closed = { args: { label: 'Closed', tone: 'ink' } };
