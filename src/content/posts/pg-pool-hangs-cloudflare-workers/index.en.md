---
title: "Why pg.Pool Hangs on Cloudflare Workers (and How to Fix It)"
date: "2026-03-01"
description: "Cloudflare Workers isolates freeze between requests, leaving pg.Pool TCP connections stale. Queries on dead sockets hang silently. The fix: close the pool after every request so the next one gets fresh connections."
tags: ["cloudflare-workers", "postgresql", "pg-pool", "serverless", "hono", "debugging"]
lang: "en"
---

# Why pg.Pool Hangs on Cloudflare Workers (and How to Fix It)

I run Hono + Emmett + Pongo on Cloudflare Workers. After deploying, sign-up worked perfectly. Then the very next request — a magic link callback, minutes later — hung every time. The Workers runtime killed it with:

> *"The Workers runtime canceled this request because it detected that your Worker's code had hung and would never generate a response."*

Here is what happened and how I fixed it.

## TL;DR

- Cloudflare Workers isolates **freeze** between requests. `pg.Pool` TCP connections go stale, but the pool does not know.
- Queries on stale sockets hang silently — no error, no timeout, just dead air.
- Fix: close the pool (`pool.end()`) after every request so the next request gets fresh connections. With Dumbo, `endAllPools()` does this for all cached pools.

## The Problem

Cloudflare Workers reuse isolates across requests. Between requests, the isolate is **frozen** — code stops executing, but module-level state survives. This includes `pg.Pool` instances and their underlying TCP sockets.

The timeline looks like this:

1. **Request 1** (sign-up): Cold start. Fresh pool. Fresh TCP connection. Works.
2. **Isolate freezes.** Minutes pass. Supabase/PgBouncer likely drops the idle TCP connection on its end (I did not confirm this in PgBouncer logs, but the behavior is consistent with an idle timeout on the server side).
3. **Request 2** (magic link callback): Isolate resumes. `pg.Pool` still has the socket object in memory. It hands out a dead connection. The SQL query is written to a dead socket. No TCP error is raised because the Workers runtime kills the request before TCP's retransmission timeout can detect the dead connection — the data goes into the void. Hang.

According to the Workers logs, the runtime killed the request after roughly 200 ms of wall time. My `connectionTimeoutMillis: 10000` never got a chance to fire.

## What Makes This Tricky

**It only happens in production.** Local dev servers do not freeze isolates, so you cannot reproduce this locally. I spent time chasing the wrong leads before realizing the local environment was fundamentally different from production.

**The first request always works.** Module-level pool caching — a standard and correct pattern for long-lived servers — guarantees a fresh connection on cold start. The bug only surfaces on the *second* request to a warm isolate.

**It looks like a Supabase issue.** I initially suspected SSL configuration, connection pooler settings, and even the ORM layer. I replaced my Pongo `findOne()` with a raw `pgPool.query()` call — still hung. That proved the issue was in `pg.Pool` itself, not in any layer above it.

## The Fix

Stop caching pools across requests. Create fresh connections per request and **close them all afterward**:

```typescript
import { endAllPools, getPool } from '@event-driven-io/dumbo'

export function dependencies() {
  return createMiddleware(async (c, next) => {
    const dbUrl = requireEnv(c, 'DATABASE_URL')

    // Fresh pool per request — no stale sockets from frozen isolates
    const pool = getPool({
      connectionString: dbUrl,
      connectionTimeoutMillis: 10000,
    })

    const eventStore = createEventStore(dbUrl, [
      /* projections */
    ])

    const pongoDb = pongoClient(dbUrl, {
      connectionOptions: { pool },
      schema: { autoMigration: 'None' },
    }).db()

    c.set('eventStore', eventStore)
    c.set('pongoDb', pongoDb)
    c.set('pgPool', pool)

    try {
      await next()
    } finally {
      // Kill all connections before the isolate freezes
      await endAllPools()
    }
  })
}
```

Key details:

- **`endAllPools()`** iterates Dumbo's internal pool cache, calls `pool.end()` on each, and removes them. This is the critical line. Note: I have not verified whether `createEventStore()` internally uses Dumbo's `getPool()` and is therefore covered by `endAllPools()`. If it manages its own connection, you may need to close it separately.
- **`autoMigration: 'None'`** on Pongo skips DDL on every request — tables are already created by Emmett's inline projections.
- Yes, every request pays the cost of a fresh TCP handshake + TLS negotiation. For my use case on Cloudflare Workers, this was the right trade-off. The alternative is silent hangs.

After deploying this change, the magic link callback and all subsequent requests worked without hanging.

## Update: A Better Approach (from the Emmett maintainer)

After publishing this article, Oskar Dudycz (Emmett's maintainer) pointed out that there's a cleaner approach. It is to share a single pool explicitly and close each consumer individually:

```typescript
import { getPool, endPool } from '@event-driven-io/dumbo'

export function dependencies() {
  return createMiddleware(async (c, next) => {
    const dbUrl = requireEnv(c, 'DATABASE_URL')

    // pass the same pool to eventStore, Pongo, and anything else
    const pool = getPool({
      connectionString: dbUrl,
      connectionTimeoutMillis: 10000,
    })

    const eventStore = getPostgreSQLEventStore(dbUrl, {
      connectionOptions: { pool },
      projections: [/* ... */],
    })

    const pongoDb = pongoClient(dbUrl, {
      connectionOptions: { pool },
      schema: { autoMigration: 'None' },
    }).db()

    c.set('eventStore', eventStore)
    c.set('pongoDb', pongoDb)
    c.set('pgPool', pool)

    try {
      await next()
    } finally {
      await eventStore.close()
      await pongoDb.close()
      await endPool(dbUrl, pool)
    }
  })
}
```

By passing the pool explicitly, you know for certain that everything shares the same connection — no hidden pool cache to worry about. `endPool()` closes just that one pool instead of wiping the entire cache.

## A Note on Other Serverless Platforms

This article focuses on Cloudflare Workers, but the underlying issue — stale TCP connections surviving across invocations — can appear on other serverless platforms too. AWS Lambda, for instance, freezes execution contexts between invocations in a similar way. The specifics differ (Lambda's freeze duration, timeout behavior, and connection handling are different from Workers), but the principle is the same: if your platform freezes state between requests, you need to account for stale connections. The pattern of cleaning up pools after each request is worth considering wherever isolate or context reuse is in play.

