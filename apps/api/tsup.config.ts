import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: 'esm',
  platform: 'node',
  target: 'node22',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  // shared поставляется исходниками на TS — вшиваем его в бандл
  noExternal: ['@nomer/shared'],
  // нативный аддон — только из node_modules
  external: ['@resvg/resvg-js'],
});
