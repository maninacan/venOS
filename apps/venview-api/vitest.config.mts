/// <reference types='vitest' />
import { defineConfig } from 'vite';

/**
 * Named `vitest.config`, not `vite.config`, on purpose: @nx/vite's plugin only
 * infers build/serve/preview targets for files that do NOT match `vitest.config`
 * (see its src/plugins/plugin.js). That keeps this from shadowing the esbuild
 * `build` target declared in package.json, while still giving the project a
 * `test` target via the plugin's testTargetName.
 *
 * Node environment — this is a server, and what's under test is pure money math.
 */
export default defineConfig(() => ({
  root: import.meta.dirname,
  cacheDir: '../../node_modules/.vite/apps/venview-api',
  test: {
    name: 'venview-api',
    environment: 'node',
    globals: true,
    include: ['src/**/*.{test,spec}.ts'],
    reporters: ['default'],
  },
}));
