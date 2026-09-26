// Image imports also need types when the root workspace is checked before an
// Astro build. Keep Astro's browser environment out of the Bun API's globals.
declare module '*.webp' {
  const image: import('astro').ImageMetadata;
  export default image;
}
