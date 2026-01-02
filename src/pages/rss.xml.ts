import rss from '@astrojs/rss';
import type { APIContext } from 'astro';
import { getAllPosts } from '@/lib/i18n';
import { SITE_TITLE, SITE_DESCRIPTION } from '@/lib/config';

export async function GET(context: APIContext) {
  const posts = await getAllPosts();

  return rss({
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    site: context.site!,
    items: posts.map((post) => ({
      title: post.data.title,
      pubDate: new Date(post.data.date),
      description: post.data.description,
      link: `/${post.data.lang}/posts/${post.slug}/`,
    })),
  });
}
