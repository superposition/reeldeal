export default {
  stories: ['../src/**/*.stories.@(js|jsx|ts|tsx)'],
  framework: {
    name: '@storybook-astro/framework',
    options: {},
  },
  staticDirs: [
    '../public',
    { from: '../src/assets', to: '/story-assets' },
  ],
};
