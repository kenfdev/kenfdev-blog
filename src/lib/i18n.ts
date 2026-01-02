import { getCollection, type CollectionEntry } from 'astro:content';
import { UI_STRINGS, DEFAULT_LANG, SUPPORTED_LANGS, type Lang } from './config';

export function t(lang: Lang, key: string): string {
  return UI_STRINGS[lang][key] || UI_STRINGS[DEFAULT_LANG][key] || key;
}

export function isValidLang(lang: string): lang is Lang {
  return SUPPORTED_LANGS.includes(lang as Lang);
}

export function getOtherLang(lang: Lang): Lang {
  return lang === 'ja' ? 'en' : 'ja';
}

export function getLangFromUrl(url: URL): Lang {
  const [, lang] = url.pathname.split('/');
  if (isValidLang(lang)) {
    return lang;
  }
  return DEFAULT_LANG;
}

// idからslugを抽出する関数
// 例: "hello-world.ja.md" → "hello-world"
export function getSlugFromId(id: string): string {
  // idの形式: "hello-world.ja.md"
  // まず拡張子を除去
  const withoutExt = id.replace(/\.md$/, '');
  const parts = withoutExt.split('.');
  if (parts.length >= 2) {
    const langPart = parts[parts.length - 1];
    if (isValidLang(langPart)) {
      return parts.slice(0, -1).join('.');
    }
  }
  return withoutExt;
}

// 拡張した記事型（slugを追加）
export type PostWithSlug = CollectionEntry<'posts'> & { slug: string };

// 言語でフィルターした記事を取得
export async function getPostsByLang(lang: Lang): Promise<PostWithSlug[]> {
  const allPosts = await getCollection('posts');
  return allPosts
    .filter((post) => post.data.lang === lang)
    .map((post) => ({ ...post, slug: getSlugFromId(post.id) }))
    .sort((a, b) => new Date(b.data.date).getTime() - new Date(a.data.date).getTime());
}

// 全記事を取得（日付降順）
export async function getAllPosts(): Promise<PostWithSlug[]> {
  const allPosts = await getCollection('posts');
  return allPosts
    .map((post) => ({ ...post, slug: getSlugFromId(post.id) }))
    .sort((a, b) => new Date(b.data.date).getTime() - new Date(a.data.date).getTime());
}

// 同じslugで別言語の記事があるか確認
export async function getAlternateLangPost(
  currentSlug: string,
  currentLang: Lang
): Promise<PostWithSlug | undefined> {
  const otherLang = getOtherLang(currentLang);
  const allPosts = await getAllPosts();
  return allPosts.find(
    (post) => post.slug === currentSlug && post.data.lang === otherLang
  );
}
