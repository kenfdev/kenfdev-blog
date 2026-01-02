// @ts-check
import { defineConfig } from 'astro/config';

// https://astro.build/config
export default defineConfig({
  site: 'https://blog.kenev.net', // 本番ドメインに変更してください
  output: 'static',
  trailingSlash: 'always',
  build: {
    format: 'directory',
  },
});
