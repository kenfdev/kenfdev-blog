---
title: "Parallel Development with devcontainer + git worktree — Piecing Together a Dev Environment for the Age of AI Agents"
date: "2026-02-22"
description: "How to enable parallel development with git worktree inside devcontainer environments. Introducing devcontainer-wt, a template repository that solves git breakage, port conflicts, and database management challenges."
tags: ["devcontainer", "git-worktree", "docker", "traefik", "ai-agents", "parallel-development"]
lang: "en"
---

I've been seeing more and more posts on X about parallel development using AI agents and git worktree. The idea is simple: spin up an agent for each branch and develop multiple features simultaneously. It's an appealing workflow. But as someone who uses devcontainers, one question kept nagging me: **"How is everyone handling port conflicts and database management?"**

In this article, I'll introduce [devcontainer-wt](https://github.com/kenfdev/devcontainer-wt), a template repository I built to enable parallel development with git worktree inside devcontainer environments. This isn't a step-by-step setup tutorial — it's more about the problems I encountered and how I approached solving them. There are a lot of moving parts and the article is on the longer side, but it's aimed at people who already use devcontainers but haven't yet tried parallel development with git worktree and AI agents.

## TL;DR

- You can do parallel development with git worktree + AI agents even if you use devcontainers
- I've published a template repository called [devcontainer-wt](https://github.com/kenfdev/devcontainer-wt) to get you started
- It's not a magic CLI — just a methodical assembly of the necessary pieces. There are a lot of moving parts
- I believe a world where this kind of workflow is seamless for developers isn't far off

## Background — "How Is Everyone Doing This?"

Posts about parallel development with git worktree and AI agents started showing up in my X timeline. For context, git worktree is a git feature that creates independent working directories for each branch. Unlike `git checkout`, it lets you have multiple branches checked out simultaneously, each in its own directory, so you can work on them in parallel.

Seeing posts like "I've got agents running on three branches, developing three features at once!" was impressive, but I couldn't help wondering — how exactly are they pulling it off?

https://x.com/kenfdev/status/2021399734385246305

From what I can tell, most people seem to be developing directly on their local machine. In that case, tools like [Portless](https://github.com/vercel-labs/portless) can probably handle port conflicts. But if you're using devcontainers, there are additional challenges beyond just ports (which I'll get into below), and Portless alone won't cover everything. I'm genuinely curious how others are handling this, so if you have a setup that works, I'd love to hear about it in the comments.

## Challenges Specific to devcontainers

### 1. git Breaks

The `.git` in a worktree directory isn't actually a directory — it's just a **file**. Its contents look something like this:

```
gitdir: /Users/you/myapp/.git/worktrees/feature-x
```

That's an absolute path on the host machine. Inside a devcontainer, this path doesn't exist. The mount point inside the container is something like `/workspaces/myapp-feature-x`, so when git tries to follow that path, it can't find it — and **every git command fails**.

### 2. Port Conflicts

devcontainers typically map container ports to the host. For example, if your app runs on port 3000, you'd write `"forwardPorts": [3000]` to make it accessible at `localhost:3000`.

When you use git worktree to develop multiple branches simultaneously, each worktree gets its own devcontainer, and each container tries to map the same port 3000 to the host. Naturally, **the second container onwards will fail with a port conflict**.

### 3. Database Sharing and Isolation

When using PostgreSQL or MySQL as infrastructure, spinning up a separate database server for each worktree is wasteful. Ideally, you'd share a single database server while logically separating databases per worktree. But automating that requires initialization scripts and cleanup on deletion.

### 4. Running Agents Inside the Container

AI agents like Claude Code typically run on the host machine. While they can edit source code directly from the host, that defeats the purpose of having a sandboxed devcontainer environment. More importantly, the whole point of running inside a container is that you can give the agent broader permissions and let it work autonomously in an isolated environment. You want the agent inside the container, using the container's toolchain and dependencies.

The result of solving each of these problems one by one is [devcontainer-wt](https://github.com/kenfdev/devcontainer-wt).

## devcontainer-wt Overview

devcontainer-wt is a **template repository** for parallel development combining devcontainers and git worktree. It's not a CLI tool.

I considered building a CLI, but the initialization requirements vary wildly depending on the tech stack — what shared services you need, what containers to spin up per worktree, how to handle database initialization and cleanup. I concluded that abstracting all of this generically was beyond me, so I went with **providing it as a template** instead.

Since it's a template, the expectation is that you'll customize it for your project. The tradeoff is flexibility — it can adapt to whatever your project requires.

### Architecture

Here's the overall structure:

```
  Browser
    |
    v
  Traefik (port 80)
    |
    |-- main.myapp.localhost        --> app-myapp-myapp:3000
    |-- feature-x.myapp.localhost   --> app-myapp-myapp-feature-x:3000
    |-- traefik.myapp.localhost     --> Traefik dashboard
    |
  Docker network: devnet-myapp
    |
    |-- postgres-myapp:5432
    |     |-- DB: myapp_myapp           (main worktree)
    |     |-- DB: myapp_myapp-feature-x (feature-x worktree)
    |
    |-- app-myapp-myapp                 (main worktree container)
    |-- app-myapp-myapp-feature-x       (feature-x worktree container)
```

At a high level, there are things that are **shared** and things that are **separate per worktree**.

### Shared

- **Traefik** (reverse proxy): A single Traefik instance handles routing for all worktrees
- **Database server** (PostgreSQL, etc.): One server, with databases logically separated per worktree
- **Docker network**: All containers join the same network. This network is defined in `docker-compose.infra.yml` and created when the main worktree starts. Feature worktree compose files reference this network as `external`, so they join the existing network
- **Container images**: Since the Dockerfile is tracked by git, images are shared across worktrees

### Separate per worktree

- **App container**: Each worktree gets its own independent container
- **Database**: A separate database within the same server for each worktree
- **Environment variables**: `init.sh` (called from `initializeCommand`) substitutes variables in `.env.app.template` (like worktree name, database name) based on worktree information and writes them out as a `.env` file. For example, if your template has `DATABASE_URL=postgres://dev:dev@postgres-${PROJECT_NAME}:5432/${PROJECT_NAME}_${WORKTREE_NAME}`, `init.sh` will substitute the variables accordingly

## Solutions to Each Challenge

Let's look at how devcontainer-wt solves the devcontainer-specific challenges listed earlier. This section covers the git breakage, port conflicts, and database management. Agent integration is covered in the "AI Agent Integration" section later.

### git Breakage → Symlinks

The problem was that the worktree's `.git` file contains host machine paths that don't resolve inside the container.

devcontainers have lifecycle hooks that let you run scripts at various stages. devcontainer-wt primarily uses `initializeCommand` (runs on the host) and `postStartCommand` (runs inside the container).

```
initializeCommand (on host)
  └─ init.sh
       ├─ Main worktree detection → sets COMPOSE_PROFILES=infra in .env
       └─ .env.app.template → expanded to .env

postStartCommand (inside container)
  └─ post-start.sh
       ├─ Create symlinks (git path fix)
       └─ Check DB exists → create & migrate
```

In devcontainer-wt, `post-start.sh` (called from `postStartCommand`) **creates symlinks** that transparently redirect host paths to container paths.

For example, if the `.git` file points to `/Users/you/myapp/.git/worktrees/feature-x`, a symlink is created inside the container like this:

```
How git path resolution works inside the container:

.git file (feature-x worktree)
  |
  |  gitdir: /Users/you/myapp/.git/worktrees/feature-x
  |           ^ host path (doesn't exist in container)
  v
Symlink
  /Users/you/myapp/.git  -->  /workspaces/myapp/.git
  |
  v
Actual target (inside container)
  /workspaces/myapp/.git/worktrees/feature-x
  ^ mounted via docker-compose.yml
```

When git tries to follow the host path, the symlink transparently redirects it to the correct path inside the container. The main worktree's `.git` directory is mounted via `docker-compose.yml`, so it's accessible from within the container.

The key point is that **the `.git` file itself is never modified**. The fix is entirely contained within the container, with zero impact on the host.

### Port Conflicts → Traefik + Subdomains

To avoid port collisions, I **stopped mapping ports to the host entirely**.

Instead, I put [Traefik](https://traefik.io/), a reverse proxy, in front and **route traffic based on subdomains**.

```
Browser
  |
  |  http://feature-x.myapp.localhost
  v
Host localhost:80
  |
  v
Traefik (only port 80 exposed to host)
  |
  |  Routes based on subdomain "feature-x"
  v
app-myapp-myapp-feature-x:3000 (inside Docker network)
```

All containers listen on the same port internally (e.g., 3000), but the only port exposed to the host is Traefik's port 80. Traefik inspects the subdomain to decide which container gets the request.

I chose Traefik because I was already familiar with it. There may be other reverse proxies that can do the same thing. What's particularly convenient about Traefik is that **you can define routing rules using Docker labels**. Traefik watches the Docker API and automatically detects container start/stop events. Just add labels to your `docker-compose.yml`, and Traefik will discover the container and set up routing — no need to manually edit config files every time you add a worktree.

As a bonus, Google Chrome resolves `localhost` subdomains to the loopback address, so `feature-x.myapp.localhost` resolves to `127.0.0.1` without touching `/etc/hosts`. This works out of the box on macOS.

### Database Sharing and Isolation → Logical Separation + Auto-initialization

A single database server runs as a shared resource, with databases logically separated per worktree.

Database names include the worktree name to avoid collisions:

```
myapp_myapp           ← main worktree DB
myapp_myapp-feature-x ← feature-x worktree DB
```

Per-worktree initialization goes in `post-start.sh`. For PostgreSQL, for example, you'd add logic like "if the database doesn't exist, create it and run migrations." Since this runs automatically when you open the devcontainer, there's no need to manually create databases.

Cleanup when removing a worktree is handled by `on-remove.sh`, which runs automatically during `worktree.sh remove`. It derives the database name from the worktree name and drops it.

### Main Worktree vs. Feature Worktrees

In devcontainer-wt, **the main worktree must be started first**. Only the main worktree is responsible for bringing up shared infrastructure (Traefik, database server). If you start a feature worktree first, the shared infrastructure won't exist, and the container will fail to connect to the network or database.

This is controlled using Docker Compose's [profiles](https://docs.docker.com/compose/profiles/) feature. Profiles let you select which services start based on the `COMPOSE_PROFILES` environment variable — a feature that many developers aren't aware of. In devcontainer-wt, `initializeCommand` calls `init.sh`, which checks whether `.git` is a directory or a file to determine if this is the main worktree. If it is, `COMPOSE_PROFILES=infra` is set in the `.env` file. This means services with `profiles: [infra]` (Traefik, PostgreSQL, etc.) only start for the main worktree. Feature worktrees don't get this profile, so only the app container starts.

### Directory Structure

Here's what the actual directory structure looks like:

```
myapp/                              ← main worktree
  .git/                             ← git database (directory)
  .devcontainer/
    devcontainer.json
    docker-compose.yml              ← app service (starts for all worktrees)
    docker-compose.infra.yml        ← shared infra (Traefik, PostgreSQL, etc. — main worktree only)
    Dockerfile
    init.sh                         ← host-side init script called from initializeCommand
    hooks/
      post-start.sh                 ← in-container setup (including git fix)
      on-remove.sh                  ← cleanup on worktree removal
  .env.app.template                 ← per-worktree env var template
  worktree.sh                       ← worktree lifecycle CLI

myapp-feature-x/                    ← feature worktree (sibling directory)
  .git                              ← file (references ../myapp/.git/worktrees/feature-x)
  .devcontainer/                    ← same files (tracked by git)
  src/                              ← same code, different branch
```

The `devcontainer.json` specifies two compose files in `dockerComposeFile`. `docker-compose.yml` defines the app service and starts for every worktree. `docker-compose.infra.yml` defines shared infrastructure (Traefik, PostgreSQL, Docker network, etc.) and has `profiles: [infra]`, so it only starts when the main worktree sets `COMPOSE_PROFILES=infra`.

## Worktree Lifecycle

The template includes a shell script called `worktree.sh` that manages the worktree lifecycle from creation to deletion. **Run it from the main worktree's root directory on the host machine** (not from inside the devcontainer).

### Create

```bash
./worktree.sh add feature-x
```

Pass a branch name to `add`. It creates a `myapp-feature-x/` directory next to the main repository. Then just open it in VS Code and "Reopen in Container."

### Remove

```bash
./worktree.sh remove ../myapp-feature-x
```

Pass a worktree path to `remove`. (Note: `add` takes a branch name while `remove` takes a path — this follows git worktree's own conventions.)

`on-remove.sh` runs, deriving the corresponding database name from the worktree name and dropping it, along with any other cleanup. Then the container is stopped and removed, and the worktree directory is deleted.

### List and Prune

```bash
./worktree.sh list    # Show worktrees and container status
./worktree.sh prune   # Clean up orphaned containers
```

`prune` is for cases where a worktree directory was manually deleted but the container is still running.

## Why I Didn't Build a CLI

I initially considered building this as a CLI tool. I wanted the experience of `devcontainer-wt init` to initialize and `devcontainer-wt add` to create worktrees.

But I couldn't see how a CLI could generically abstract away all these problems:

- **Initialization varies wildly by tech stack**: Node.js needs `npm install`, Python needs `pip install`, Go needs `go mod download`. Migration tools differ by project too
- **Shared services differ by project**: Just PostgreSQL? Redis too? Or nothing at all?
- **Cleanup logic differs**: Which databases to drop, whether to clear caches — it all depends on the project

Abstracting all of this was beyond my current capacity. Providing it as a template and letting each project customize it felt more realistic.

## Real-world Usage

I'm actually using this template for parallel development on a service built with Cloudflare Pages + Cloudflare Workers + Supabase. From local development through to production deployment, this setup handles everything.

I've also prepared a minimal example applied to a Node.js project:

https://x.com/kenfdev/status/2024754983984574759

The repository is here: [devcontainer-wt-nodejs-sample](https://github.com/kenfdev/devcontainer-wt-nodejs-sample)

Beyond local devcontainers, this also works with **Remote SSH devcontainers** with minimal changes. The only thing to watch out for is making sure you forward Traefik's port to the host.

## AI Agent Integration

To use agents (like Claude Code) inside the container, simply install the agent as a development tool in your Dockerfile. This is standard practice for devcontainers — just include it in the Dockerfile like any other CLI tool. With the agent inside the container, it can use the container's toolchain and dependencies directly.

devcontainer-wt also includes an Agent Skill file that documents the template's structure and customization points. This helps the agent understand the template's context and assist with troubleshooting.

## Pros and Cons

### Pros

- **Parallel development works with devcontainers**: Using devcontainers doesn't mean you can't do parallel development
- **No more port conflicts**: With Traefik + subdomains, you can add as many worktrees as you want without port collisions
- **Independent environments per worktree**: Databases and environment variables are isolated per worktree
- **Container images are shared**: Since the Dockerfile is tracked by git, there's rarely a need to rebuild for each worktree. Second worktree onwards starts up quickly
- **Fully customizable**: As a template, you can adjust everything to match your project's tech stack

### Cons

- **Too many moving parts**: Docker, Docker Compose, Traefik, devcontainer, git worktree, shell scripts... the cognitive load of the dev environment alone is significant
- **Debugging is hard when things break**: Once set up, you don't think about it day-to-day, but when something goes wrong, you need a reasonable understanding of Docker and networking. It can also be confusing whether an agent is running inside the container or on the host
- **Main worktree must start first**: Shared infrastructure launches from the main worktree, so there's a startup order constraint
- **It's not magic**: This isn't a "press one button and everything works" experience. It's an honest, methodical assembly of the necessary pieces

## Looking Ahead

Personally, I feel like the developer experience around this will improve significantly before long. I imagine a world where developers don't have to cobble together "devcontainer + git worktree + agents" by hand — where parallel development just works out of the box.

https://x.com/bcherny/status/2025007393290272904?s=20

Claude Code has already added CLI support for worktrees, which is a step in that direction.

Related projects are also emerging, like [BranchBox](https://github.com/branchbox/branchbox), which provides a CLI for parallel development with devcontainers and git worktree, and [Discobot](https://github.com/obot-platform/discobot) (by Darren Shepherd), which isolates container environments per chat session.

https://x.com/ibuildthecloud/status/2023795171264262312?s=20

For now, the setup described in this article is working well for my development workflow. That said, I'm hoping the ecosystem matures and this all becomes much simpler.

## Wrapping Up

In this article, I introduced [devcontainer-wt](https://github.com/kenfdev/devcontainer-wt), a template repository for parallel development with devcontainers and git worktree.

When you use devcontainers, parallel development with git worktree brings challenges that don't exist in local development: git breakage, port conflicts, and database management. devcontainer-wt solves these with symlinks, Traefik-based subdomain routing, and logical database separation.

It's not a magic tool. It requires per-project customization and there are a lot of moving parts. But if this article convinced you that **parallel development is possible even with devcontainers**, I'll consider it a success.

If you know a simpler way to achieve this, I'd love to hear about it. There's plenty of room for improvement.

## References

- [devcontainer-wt](https://github.com/kenfdev/devcontainer-wt) — The template repository introduced in this article
- [devcontainer-wt-nodejs-sample](https://github.com/kenfdev/devcontainer-wt-nodejs-sample) — Sample application of the template to a Node.js project
- [BranchBox](https://github.com/branchbox/branchbox) — CLI tool for parallel development with devcontainers and git worktree
- [Discobot](https://github.com/obot-platform/discobot) — Container isolation per session approach
- [Portless](https://github.com/vercel-labs/portless) — Tool for resolving port conflicts
- [Traefik](https://traefik.io/) — Docker-aware reverse proxy
