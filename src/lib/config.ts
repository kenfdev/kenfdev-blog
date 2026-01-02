export const SITE_TITLE = 'kenfdev\'s Blog';
export const SITE_DESCRIPTION = 'A personal blog about web development';
export const DEFAULT_LANG = 'en' as const;
export const SUPPORTED_LANGS = ['ja', 'en'] as const;

export type Lang = (typeof SUPPORTED_LANGS)[number];

export const UI_STRINGS: Record<Lang, Record<string, string>> = {
  ja: {
    posts: '記事一覧',
    rss: 'RSS',
    home: 'ホーム',
    readMore: '続きを読む',
    postedOn: '投稿日:',
    tags: 'タグ:',
    notFound: 'ページが見つかりません',
    notFoundMessage: 'お探しのページは存在しないか、移動した可能性があります。',
    backToHome: 'ホームに戻る',
    langSwitch: 'English',
    allPosts: 'すべての記事',
  },
  en: {
    posts: 'Posts',
    rss: 'RSS',
    home: 'Home',
    readMore: 'Read more',
    postedOn: 'Posted on:',
    tags: 'Tags:',
    notFound: 'Page Not Found',
    notFoundMessage: 'The page you are looking for does not exist or has been moved.',
    backToHome: 'Back to Home',
    langSwitch: '日本語',
    allPosts: 'All Posts',
  },
};
