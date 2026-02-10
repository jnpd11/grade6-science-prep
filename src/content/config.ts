import { defineCollection, z } from 'astro:content';

const lessons = defineCollection({
  type: 'content',
  schema: z.object({
    title: z.string(),
    unit: z.string().optional(),
    order: z.number(),
    summary: z.string().optional(),
    keywords: z.array(z.string()).default([]),
    minutes: z.number().optional(),
    image: z.string().optional(),
  }),
});

export const collections = { lessons };
