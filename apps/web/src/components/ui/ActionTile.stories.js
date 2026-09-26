import ActionTile from './ActionTile.astro';

export default {
  title: 'ReelDeal/01 Atoms/Action Tile',
  component: ActionTile,
  args: { label: 'Observe', tone: 'blue' },
  argTypes: {
    tone: { control: 'select', options: ['blue', 'pink', 'yellow', 'lime'] },
  },
};

export const Static = {};
export const Review = { args: { label: 'Review', tone: 'pink' } };
export const List = { args: { label: 'List', tone: 'lime' } };
export const Prove = { args: { label: 'Prove', tone: 'yellow' } };
export const Linked = { args: { label: 'Browse lots', tone: 'blue', href: '/shop/' } };
