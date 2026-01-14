---
title: "direnv で実現する安全な .mcp.json 管理 ― API キーをリポジトリに晒さないために"
date: "2026-01-14"
description: "MCP サーバーの設定ファイル .mcp.json に API キーを直接書いていませんか？direnv を使って機密情報を環境変数として安全に管理し、git への誤コミットを防ぐ方法を紹介します。"
tags: ["direnv", "mcp", "security", "claude-code", "dotfiles"]
lang: "ja"
---

# direnv で実現する安全な .mcp.json 管理 ― API キーをリポジトリに晒さないために

`.mcp.json` に API キーを直接書いていませんか？この記事では、direnv を活用して機密情報を安全に管理する方法を紹介します。

> **対象環境**: この記事では macOS + Zsh 環境を前提に説明します。他の環境については [direnv 公式ドキュメント](https://direnv.net/) を参照してください。
>
> **対象読者**: MCP（Model Context Protocol）を既に利用している方を対象としています。
>
> **この記事で扱う脅威**: git への誤コミットによる API キーの漏洩を防ぐことが目的です。ローカル環境のセキュリティや、より高度な脅威については別途対策が必要です。

## TL;DR

- MCP サーバーの設定ファイル `.mcp.json` に API キーを直接書くと、git にコミットしてしまうリスクがある
- **direnv** を使えば、環境変数として機密情報を管理し、`.mcp.json` からは `${VAR_NAME}` 形式で参照できる
- `.envrc` には `dotenv_if_exists .env` だけを書いて Git 管理し、機密情報は `.env` に分離する

## はじめに

MCP サーバーの中には認証に API キーが必要なものがあり、それを `.mcp.json` の `env` フィールドに直接書くしか方法がない場合があります。

開発中はそれでも動くのですが、いざ dotfiles として管理しようとしたり、リポジトリにプッシュしようとしたとき、「あ、これまずいな」と気づくわけです。私自身も何度かヒヤリとした経験があり、仕組みで防ぐことにしました。

この記事では、そんな悩みを **direnv** で解決する方法を、インストールから実際の設定まで説明していきます。

## 何が問題なのか

まず、典型的な改善前の `.mcp.json` の例を見てみましょう。ここでは [n8n-mcp](https://github.com/czlonkowski/n8n-mcp)（n8n のワークフローを MCP 経由で操作できるサーバー）を例に使います。

```json
{
  "mcpServers": {
    "n8n-mcp": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "n8n-mcp"],
      "env": {
        "N8N_API_URL": "https://n8n.example.com",
        "N8N_API_KEY": "n8n_api_xxxxxxxxxxxxxxxxxxxxxxxx"
      }
    }
  }
}
```

一見、README通りに設定して何の問題もなさそうですよね。でも、よく見てください。**API キーがそのまま書かれています。**

このファイルをうっかり git にコミットしてしまったら？

- GitHub のパブリックリポジトリに公開されてしまう
- dotfiles として管理している場合、誰でも閲覧できてしまう
- 一度コミット履歴に入ると、削除しても履歴から復元できてしまう

## direnv とは

環境変数を管理する方法はいくつかありますが、`.zshrc` に直接書くとプロジェクト外での管理になりますし、毎回 `source` コマンドで読み込むのも面倒です。以前から名前を聞いていた **direnv** が便利そうだったので、今回はこれを採用しました。

**direnv** は、ディレクトリごとに環境変数を自動で設定・解除してくれるツールです。

仕組みはシンプルで、`.envrc` というファイルに環境変数の定義を書いておくと、そのディレクトリに `cd` したときに自動で読み込まれ、離れると自動で解除されます。

```
~/projects/
├── project-a/
│   └── .envrc  ← cd すると自動で読み込まれる
└── project-b/
    └── .envrc  ← 別の設定が読み込まれる
```

これを活用すれば、`.mcp.json` には環境変数の**参照**だけを書き、実際の値は別ファイルに分離できます。

### メリット

- **機密情報がリポジトリに入らない**: `.env` を `.gitignore` に追加しておけば安心
- **dotfiles として管理しやすい**: `.mcp.json` と `.envrc` は公開しても問題なくなる
- **環境ごとに値を変えられる**: 開発環境と本番環境で異なる API キーを使い分けられる
- **他の用途にも使える**: direnv は MCP に限らず、あらゆるプロジェクトで活用できる

### デメリット

- **direnv のインストールと設定が必要**: 初回のセットアップに少し手間がかかる
- **`direnv allow` を忘れがち**: `.envrc` を編集するたびに再許可が必要
- **ターミナルからの起動が前提**: GUI アプリケーションから直接起動する場合は環境変数が読み込まれない

## direnv のインストール

Homebrew を使ってインストールします。

```bash
brew install direnv
```

インストールできたら、バージョンを確認しておきましょう。

```bash
direnv version
```

## シェルへのフック設定

direnv を有効にするには、シェルの設定ファイルにフックを追加する必要があります。

`~/.zshrc` に以下を追加します。

```bash
eval "$(direnv hook zsh)"
```

設定を追加したら、シェルを再起動するか、設定ファイルを再読み込みしてください。

```bash
source ~/.zshrc
```

## .envrc と .env の作成

ここでは、先ほど例に挙げた [n8n-mcp](https://github.com/czlonkowski/n8n-mcp) を使って実際に設定してみましょう。

この記事では、**`.envrc` と `.env` を分離する構成**を採用します。

- **`.envrc`**: direnv の設定ファイル。`dotenv_if_exists .env` だけを書き、**Git で管理する**
- **`.env`**: 実際の機密情報を書くファイル。**`.gitignore` に追加して Git 管理しない**

### .envrc の作成

`.mcp.json` があるディレクトリ（通常はホームディレクトリやプロジェクトルート）に `.envrc` ファイルを作成します。

```bash
# .envrc
dotenv_if_exists .env
```

`dotenv_if_exists` は direnv の組み込み関数で、指定したファイル（ここでは `.env`）が存在すれば読み込み、存在しなければ何もしません。これにより、`.envrc` 自体には機密情報を含めずに済みます。

### .env の作成

同じディレクトリに `.env` ファイルを作成し、機密情報を記述します。

```bash
# .env
N8N_API_KEY=n8n_api_xxxxxxxxxxxxxxxxxxxxxxxx
```

> **注意**: `.env` ファイルには `export` は不要です。`KEY=VALUE` 形式で記述します。

### direnv allow の実行

ファイルを作成したら、**必ず `direnv allow` を実行してください。**

```bash
direnv allow
```

これは direnv のセキュリティ機能です。`.envrc` が勝手に実行されないよう、明示的に許可する必要があります。新しいディレクトリの `.envrc` を読み込んだり、`.envrc` を編集したりするたびに、この操作が必要になります。

許可すると、以下のようなメッセージが表示されます。

```
direnv: loading ~/projects/my-project/.envrc
direnv: export +N8N_API_KEY
```

環境変数が正しく設定されているか確認してみましょう。

```bash
echo $N8N_API_KEY
# n8n_api_xxxxxxxxxxxxxxxxxxxxxxxx と表示されれば成功
```

## .mcp.json での環境変数参照

準備ができたので、`.mcp.json` を書き換えましょう。

Claude Code は `.mcp.json` の `env` フィールド内の `${VAR_NAME}` 形式を認識し、MCP サーバー起動時に環境変数の値で置換します。

**改善前:**

```json
{
  "mcpServers": {
    "n8n-mcp": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "n8n-mcp"],
      "env": {
        "N8N_API_URL": "https://n8n.example.com",
        "N8N_API_KEY": "n8n_api_xxxxxxxxxxxxxxxxxxxxxxxx"
      }
    }
  }
}
```

**改善後:**

```json
{
  "mcpServers": {
    "n8n-mcp": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "n8n-mcp"],
      "env": {
        "N8N_API_URL": "https://n8n.example.com",
        "N8N_API_KEY": "${N8N_API_KEY}"
      }
    }
  }
}
```

変更点は `N8N_API_KEY` の値だけです。直接の値を書く代わりに、`${N8N_API_KEY}` という形式で環境変数を参照しています。

これで、`.mcp.json` をコミットしても、API キー自体は含まれません。

## .gitignore への追加

最後に、`.env` を `.gitignore` に追加することを忘れないでください。

```bash
echo ".env" >> .gitignore
```

これで、`.env` がうっかりコミットされることを防げます。

## まとめ

この記事では、direnv を使って `.mcp.json` から機密情報を分離する方法を紹介しました。

最終的なファイル構成は以下のようになります：

```
~/
├── .mcp.json      ← ${VAR_NAME} で参照（Git管理可）
├── .envrc         ← dotenv_if_exists .env（Git管理可）
├── .env           ← 機密情報（.gitignore で除外）
└── .gitignore     ← .env を記載
```

手順を振り返ると、

1. direnv をインストールする
2. シェルにフックを設定する
3. `.envrc` に `dotenv_if_exists .env` を記述する（Git 管理可）
4. `.env` に機密情報を定義する（Git 管理しない）
5. `direnv allow` で許可する
6. `.mcp.json` では `${VAR_NAME}` 形式で参照する
7. `.env` を `.gitignore` に追加する

これで、API キーをリポジトリに晒すリスクを減らせます。

もちろん、これは銀の弾丸ではありません。具体的には以下のようなケースでは、より専門的なツールの検討をお勧めします：

- **チーム全体でシークレットを一元管理したい場合**: AWS Secrets Manager、HashiCorp Vault など
- **本番環境でのシークレット管理**: 環境変数ではなく、専用のシークレット管理サービスを使うべき

ただ、個人開発やちょっとした dotfiles 管理には、direnv は十分にシンプルで強力なソリューションです。

MCP を安全に活用していきましょう。
