import { defineCollection, z } from 'astro:content';

const postsCollection = defineCollection({
  type: 'content',
  schema: z.object({
    title: z.string(),
    date: z.string(), // ISO文字列
    description: z.string(),
    tags: z.array(z.string()).default([]),
    lang: z.enum(['ja', 'en']),
  }),
});

export const collections = {
  posts: postsCollection,
};
