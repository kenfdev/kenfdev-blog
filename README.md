# kenfdev-blog

多言語対応のAstro製ブログ。

## 技術スタック

- Astro (静的出力)
- Content Collections (Markdown)
- 素のCSS

## ローカル開発

```bash
# 依存関係のインストール
npm install

# 開発サーバー起動 (http://localhost:4321)
npm run dev

# ビルド
npm run build

# ビルド結果のプレビュー
npm run preview
```

## プロジェクト構造

```
/
├── public/
│   ├── favicon.svg
│   └── _redirects          # Cloudflare Pages用リダイレクト
├── src/
│   ├── content/
│   │   ├── config.ts       # Content Collection定義
│   │   └── posts/          # ブログ記事 (Markdown)
│   ├── layouts/
│   │   └── BaseLayout.astro
│   ├── lib/
│   │   ├── config.ts       # サイト設定・UI文字列
│   │   └── i18n.ts         # 多言語ユーティリティ
│   ├── pages/
│   │   ├── index.astro     # / → /ja/ リダイレクト
│   │   ├── 404.astro
│   │   ├── rss.xml.ts      # 全体RSS
│   │   └── [lang]/
│   │       ├── index.astro
│   │       ├── rss.xml.ts  # 言語別RSS
│   │       └── posts/
│   │           ├── index.astro
│   │           └── [slug].astro
│   └── styles/
│       └── global.css
├── astro.config.mjs
└── package.json
```

## URL設計

| パス | 説明 |
|------|------|
| `/` | `/ja/` へ301リダイレクト |
| `/ja/` | 日本語トップ |
| `/en/` | 英語トップ |
| `/ja/posts/` | 日本語記事一覧 |
| `/en/posts/` | 英語記事一覧 |
| `/ja/posts/{slug}/` | 日本語記事 |
| `/en/posts/{slug}/` | 英語記事 |
| `/rss.xml` | 全言語RSS |
| `/ja/rss.xml` | 日本語RSS |
| `/en/rss.xml` | 英語RSS |

## 記事の追加

`src/content/posts/` に Markdown ファイルを追加します。

ファイル名: `{slug}.{lang}.md`

例:
- `my-article.ja.md` (日本語)
- `my-article.en.md` (英語)

### Frontmatter

```yaml
---
title: "記事タイトル"
date: "2025-01-01"
description: "記事の説明"
tags: ["tag1", "tag2"]
lang: "ja"
---
```

**注意:** slugはファイル名から自動的に抽出されます（`my-article.ja.md` → `/ja/posts/my-article/`）

## Cloudflare Pagesへのデプロイ

### Cloudflare Pages設定

| 項目 | 値 |
|------|-----|
| Build command | `npm run build` |
| Build output directory | `dist` |
| Node.js version | `20` |

### 本番ドメイン設定

`astro.config.mjs` の `site` を本番ドメインに変更してください：

```js
export default defineConfig({
  site: 'https://your-domain.com',
  // ...
});
```

## ライセンス

MIT
