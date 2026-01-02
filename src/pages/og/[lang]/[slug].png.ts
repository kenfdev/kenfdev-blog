import type { APIRoute, GetStaticPaths } from "astro";
import { getCollection } from "astro:content";
import satori from "satori";
import sharp from "sharp";
import fs from "fs/promises";
import { getSlugFromId } from "@/lib/i18n";

export const getStaticPaths: GetStaticPaths = async () => {
  const posts = await getCollection("posts");
  return posts.map((post) => ({
    params: { lang: post.data.lang, slug: getSlugFromId(post.id) },
    props: { post },
  }));
};

export const GET: APIRoute = async ({ props }) => {
  const { post } = props as { post: Awaited<ReturnType<typeof getCollection<"posts">>>[number] };
  const fontData = await fs.readFile("./public/fonts/NotoSansCJKjp-Bold.otf");

  const svg = await satori(
    {
      type: "div",
      props: {
        style: {
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "60px",
          background: "linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)",
        },
        children: [
          {
            type: "div",
            props: {
              style: {
                fontSize: "56px",
                fontWeight: "bold",
                color: "#fff",
                lineHeight: 1.3,
                fontFamily: "Noto Sans CJK JP",
              },
              children: post.data.title,
            },
          },
          {
            type: "div",
            props: {
              style: {
                fontSize: "24px",
                color: "#888",
                marginTop: "30px",
                fontFamily: "Noto Sans CJK JP",
              },
              children: "blog.kenev.net",
            },
          },
        ],
      },
    },
    {
      width: 1200,
      height: 630,
      fonts: [
        {
          name: "Noto Sans CJK JP",
          data: fontData,
          weight: 700,
          style: "normal",
        },
      ],
    }
  );

  const png = await sharp(Buffer.from(svg)).png().toBuffer();

  return new Response(png, {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
};
