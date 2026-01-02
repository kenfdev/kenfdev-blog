import { defineCollection, z } from 'astro:content';

const postsCollection = defineCollection({
  type: 'content',
  schema: ({ image }) => z.object({
    title: z.string(),
    date: z.string(), // ISO文字列
    description: z.string(),
    tags: z.array(z.string()).default([]),
    lang: z.enum(['ja', 'en']),
    cover: image().optional(),
    coverAlt: z.string().optional(),
  }),
});

export const collections = {
  posts: postsCollection,
};
