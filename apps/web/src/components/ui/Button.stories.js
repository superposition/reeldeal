import Button from './Button.astro';

export default {
  title: 'ReelDeal/01 Atoms/Button',
  component: Button,
  args: { tone: 'yellow', variant: 'primary', slots: { default: 'Browse lots' } },
  argTypes: {
    tone: { control: 'select', options: ['blue', 'pink', 'yellow', 'ink'] },
    variant: { control: 'select', options: ['primary', 'secondary'] },
  },
};

export const PrimaryYellow = {};
export const PrimaryBlue = { args: { tone: 'blue', slots: { default: 'Browse lots' } } };
export const PrimaryPink = { args: { tone: 'pink', slots: { default: 'Record landing' } } };
export const PrimaryInk = { args: { tone: 'ink', slots: { default: 'Confirm' } } };
export const Secondary = { args: { variant: 'secondary', tone: 'blue', slots: { default: 'View details' } } };
export const Disabled = { args: { disabled: true, slots: { default: 'Unavailable' } } };
export const Link = { args: { href: '/shop/', tone: 'blue', slots: { default: 'Open shop' } } };
