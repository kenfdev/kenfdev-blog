---
title: "Secure .mcp.json Management with direnv — Keep Your API Keys Out of Git"
date: "2026-01-14"
description: "Are you hardcoding API keys in your .mcp.json? Learn how to use direnv to safely manage sensitive credentials as environment variables and prevent accidental git commits."
tags: ["direnv", "mcp", "security", "claude-code", "dotfiles"]
lang: "en"
---

Are you hardcoding API keys directly in your `.mcp.json`? This article shows you how to use direnv to manage sensitive credentials safely.

> **Target Environment**: This article assumes macOS + Zsh. For other environments, check the [official direnv documentation](https://direnv.net/).
>
> **Target Audience**: This is written for developers already using MCP (Model Context Protocol).
>
> **Threat Model**: This article focuses on preventing API key leaks through accidental git commits. Local security and more advanced threats require additional measures.

## TL;DR

- Hardcoding API keys in your `.mcp.json` MCP server configuration puts you at risk of accidentally committing them to git
- **direnv** lets you manage sensitive data as environment variables and reference them in `.mcp.json` using `${VAR_NAME}` syntax
- Write only `dotenv_if_exists .env` in `.envrc` (commit this), and keep sensitive data in `.env` (don't commit this)

## Introduction

Some MCP servers require API keys for authentication, and sometimes the only way to configure them is by writing them directly in the `env` field of your `.mcp.json`.

This works fine during development, but the moment you try to manage it as part of your dotfiles or push it to a repository, you realize: "Wait, this is a bad idea." I've had several close calls myself, so I decided to solve this systematically.

This article walks through solving this problem with **direnv**, from installation to actual configuration.

## What's the Problem?

Let's look at a typical "before" example of `.mcp.json`. I'll use [n8n-mcp](https://github.com/czlonkowski/n8n-mcp) (an MCP server for controlling n8n workflows) as an example.

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

At first glance, this looks fine—just following the README. But look closer. **The API key is right there in plain text.**

What happens if you accidentally commit this file to git?

- It gets published to a public GitHub repository
- If you're managing it as dotfiles, anyone can read it
- Once it's in the commit history, even deleting it won't help—it can still be recovered from history

## What is direnv?

There are several ways to manage environment variables, but writing them directly in `.zshrc` means managing them outside your project, and manually running `source` every time is tedious. I'd heard about **direnv** for a while and it seemed convenient, so I decided to try it.

**direnv** is a tool that automatically loads and unloads environment variables based on your current directory.

The concept is simple: you write environment variable definitions in a file called `.envrc`, and when you `cd` into that directory, they're automatically loaded. When you leave, they're automatically unloaded.

```
~/projects/
├── project-a/
│   └── .envrc  ← Automatically loaded when you cd here
└── project-b/
    └── .envrc  ← Different settings loaded here
```

Using this, you can keep only **references** to environment variables in `.mcp.json`, while storing the actual values in a separate file.

### Benefits

- **Sensitive data stays out of your repository**: Add `.env` to `.gitignore` and you're safe
- **Easy to manage as dotfiles**: `.mcp.json` and `.envrc` can be safely committed
- **Different values per environment**: Use different API keys for development and production
- **Works beyond MCP**: direnv is useful for any project, not just MCP

### Drawbacks

- **Requires direnv installation and setup**: Initial setup takes a bit of effort
- **Easy to forget `direnv allow`**: You need to re-allow every time you edit `.envrc`
- **Assumes terminal-based workflows**: Environment variables won't be loaded when launching GUI apps directly

## Installing direnv

Install using Homebrew:

```bash
brew install direnv
```

Once installed, verify the version:

```bash
direnv version
```

## Setting Up the Shell Hook

To enable direnv, you need to add a hook to your shell configuration.

Add this to your `~/.zshrc`:

```bash
eval "$(direnv hook zsh)"
```

After adding this, restart your shell or reload the configuration:

```bash
source ~/.zshrc
```

## Creating .envrc and .env

Let's set this up using the [n8n-mcp](https://github.com/czlonkowski/n8n-mcp) example from earlier.

This article uses an approach that **separates `.envrc` and `.env`**:

- **`.envrc`**: The direnv configuration file. Contains only `dotenv_if_exists .env`. **Commit this to Git**
- **`.env`**: Contains actual sensitive data. **Add to `.gitignore`, don't commit**

### Creating .envrc

Create a `.envrc` file in the directory where your `.mcp.json` lives (typically your home directory or project root):

```bash
# .envrc
dotenv_if_exists .env
```

`dotenv_if_exists` is a built-in direnv function that loads the specified file (`.env` in this case) if it exists, or does nothing if it doesn't. This keeps sensitive data out of `.envrc` itself.

### Creating .env

Create a `.env` file in the same directory with your sensitive credentials:

```bash
# .env
N8N_API_KEY=n8n_api_xxxxxxxxxxxxxxxxxxxxxxxx
```

> **Note**: Don't use `export` in `.env` files. Just write `KEY=VALUE`.

### Running direnv allow

After creating these files, **you must run `direnv allow`:**

```bash
direnv allow
```

This is a security feature of direnv. It prevents `.envrc` files from executing automatically—you have to explicitly allow them. You'll need to do this every time you add a new `.envrc` or edit an existing one.

After allowing, you'll see a message like this:

```
direnv: loading ~/projects/my-project/.envrc
direnv: export +N8N_API_KEY
```

Let's verify the environment variable is set correctly:

```bash
echo $N8N_API_KEY
# Should output: n8n_api_xxxxxxxxxxxxxxxxxxxxxxxx
```

## Referencing Environment Variables in .mcp.json

Now we're ready to update `.mcp.json`.

Claude Code recognizes the `${VAR_NAME}` syntax in the `env` field of `.mcp.json` and substitutes environment variable values when launching the MCP server.

**Before:**

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

**After:**

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

The only change is the `N8N_API_KEY` value. Instead of the actual key, we're referencing the environment variable using `${N8N_API_KEY}`.

Now you can commit `.mcp.json` without exposing the actual API key.

## Adding to .gitignore

Finally, don't forget to add `.env` to your `.gitignore`:

```bash
echo ".env" >> .gitignore
```

This prevents accidentally committing `.env`.

## Summary

This article showed you how to separate sensitive data from `.mcp.json` using direnv.

The final file structure looks like this:

```
~/
├── .mcp.json      ← References ${VAR_NAME} (safe to commit)
├── .envrc         ← Contains dotenv_if_exists .env (safe to commit)
├── .env           ← Contains sensitive data (excluded via .gitignore)
└── .gitignore     ← Lists .env
```

To recap the steps:

1. Install direnv
2. Set up the shell hook
3. Write `dotenv_if_exists .env` in `.envrc` (commit this)
4. Define sensitive data in `.env` (don't commit this)
5. Allow with `direnv allow`
6. Reference variables in `.mcp.json` using `${VAR_NAME}` syntax
7. Add `.env` to `.gitignore`

This significantly reduces the risk of exposing API keys in your repository.

Of course, this isn't a silver bullet. For more demanding scenarios, consider specialized tools:

- **Team-wide secret management**: AWS Secrets Manager, HashiCorp Vault, etc.
- **Production secret management**: Use dedicated secret management services instead of environment variables

That said, for personal projects and dotfiles management, direnv is a simple and powerful solution.

Let's use MCP safely!
