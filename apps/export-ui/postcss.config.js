// PostCSS pipeline for the export-ui Vite build.
// Tailwind 3.4 + Autoprefixer. Order matters: Tailwind first (generates utilities),
// then Autoprefixer adds vendor prefixes to the emitted CSS.
export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
