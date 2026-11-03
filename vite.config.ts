import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

/** Repo name on GitHub Pages: https://chrononaut777.github.io/vehicle-rtd/ */
const pagesBase = process.env.GITHUB_PAGES === 'true' ? '/vehicle-rtd/' : '/';

export default defineConfig({
  base: pagesBase,
  plugins: [react()],
  test: {
    environment: 'node',
  },
});
