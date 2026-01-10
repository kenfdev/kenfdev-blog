// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

// https://astro.build/config
export default defineConfig({
  site: 'https://blog.kenev.net', // 本番ドメインに変更してください
  output: 'static',
  trailingSlash: 'always',
  build: {
    format: 'directory',
  },
  integrations: [
    sitemap({
      filter: (page) => {
        // Only include canonical URLs with language prefix (/en/ or /ja/)
        // Exclude redirect pages (/, /posts/, /posts/*)
        const url = new URL(page);
        const path = url.pathname;
        return path.startsWith('/en/') || path.startsWith('/ja/');
      },
    }),
  ],
});
