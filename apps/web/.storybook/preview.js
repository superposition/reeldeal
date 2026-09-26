import './preview.css';

export default {
  initialGlobals: {
    viewport: { value: 'mobile393', isRotated: false },
  },
  parameters: {
    layout: 'centered',
    viewport: {
      defaultViewport: 'mobile393',
      viewports: {
        mobile393: { name: 'Mobile 393', styles: { width: '393px', height: '852px' } },
        desktop1280: { name: 'Desktop 1280', styles: { width: '1280px', height: '900px' } },
      },
    },
    backgrounds: {
      default: 'paper',
      values: [
        { name: 'paper', value: '#fffaf2' },
        { name: 'blue', value: '#18b8ee' },
      ],
    },
  },
};
