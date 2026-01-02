---
title: Cross Module Transaction with Prisma
description: "How to write cross-module transactions in Node.js using Prisma and cls-hooked for a layered architecture."
date: "2022-06-14"
tags: ["prisma", "nodejs", "database", "transaction"]
lang: "en"
---

## TL;DR

- It's possible to write transactions in the application layer using Prisma with the help of `cls-hooked`
  - Here's some [sample codes](https://github.com/kenfdev/prisma-auto-transaction-poc/blob/deaa43679b8e474b11c0a094dc60680e0ab3d876/src/usecases/__tests__/integration/createOrder.test.ts)
- The PoC code: https://github.com/kenfdev/prisma-auto-transaction-poc

## Prisma and Interactive Transaction

There's no doubt that [Prisma](https://www.prisma.io/) boosts your productivity when dealing with Databases in Node.js + TypeScript. But as you start creating complex software, there are some cases you can't use Prisma the way you'd like to out of the box. One of them is when you want to use the [interactive transaction](https://www.prisma.io/docs/concepts/components/prisma-client/transactions#interactive-transactions-in-preview) across modules.

What I mean by **cross module** is a bit obscure. Let's look at how you can write interactive transactions in Prisma. The following code is from the official docs.

```js
await prisma.$transaction(async (prisma) => {
  // 1. Decrement amount from the sender.
  const sender = await prisma.account.update({
    data: {
      balance: {
        decrement: amount,
      },
    },
    where: {
      email: from,
    },
  })
  // 2. Verify that the sender's balance didn't go below zero.
  if (sender.balance < 0) {
    throw new Error(`${from} doesn't have enough to send ${amount}`)
  }
  // 3. Increment the recipient's balance by amount
  const recipient = prisma.account.update({
    data: {
      balance: {
        increment: amount,
      },
    },
    where: {
      email: to,
    },
  })
  return recipient
})
```

The point is that you call `prisma.$transaction` and you pass a callback to it with the parameter `prisma`. Inside the transaction, you use the `prisma` instance passed as the callback to use it as the **transaction prisma client**. It's simple and easy to use. But what if you don't want to show the `prisma` interface inside the transaction code? Perhaps you're working with a enterprise-ish app and have a layered architecture and you are not allowed to use the `prisma` client in say, the application layer.

It's probably easier to look at it in code. Suppose you would like to write some transaction code like this:

```js
await $transaction(async () => {
  // call multiple repository methods inside the transaction
  // if either fails, the transaction will rollback
  await this.orderRepo.create(order);
  await this.notificationRepo.send(
    `Successfully created order: ${order.id}`
  );
});
```

There are multiple Repositories that hide the implementation details(e.g. Prisma, SNS, etc.). You would not want to show `prisma` inside this code because it is an implementation detail. So how can you deal with this using Prisma? It's actually not that easy because you'll somehow have to pass the Transaction Prisma Client to the Repository across modules without explicitly passing it. 

## Creating a custom TransactionScope

This is when I came across [this issue comment](https://github.com/prisma/prisma/issues/5729#issuecomment-959137819). It says you can use [cls-hooked](https://www.npmjs.com/package/cls-hooked) to create a thread-like local storage to temporarily store the Transaction Prisma Client, and then get the client from somewhere else via CLS (Continuation-Local Storage) afterwards.

After looking at how I can use `cls-hooked`, here is a `TransactionScope` class I've created to create a transaction which can be used from any layer:

```ts
export class PrismaTransactionScope implements TransactionScope {
  private readonly prisma: PrismaClient;
  private readonly transactionContext: cls.Namespace;

  constructor(prisma: PrismaClient, transactionContext: cls.Namespace) {
    // inject the original Prisma Client to use when you actually create a transaction
    this.prisma = prisma;
    // A CLS namespace to temporarily save the Transaction Prisma Client
    this.transactionContext = transactionContext;
  }

  async run(fn: () => Promise<void>): Promise<void> {
    // attempt to get the Transaction Client
    const prisma = this.transactionContext.get(
      PRISMA_CLIENT_KEY
    ) as Prisma.TransactionClient;

    // if the Transaction Client
    if (prisma) {
      // exists, there is no need to create a transaction and you just execute the callback
      await fn();
    } else {
      // does not exist, create a Prisma transaction 
      await this.prisma.$transaction(async (prisma) => {
        await this.transactionContext.runPromise(async () => {
          // and save the Transaction Client inside the CLS namespace to be retrieved later on
          this.transactionContext.set(PRISMA_CLIENT_KEY, prisma);

          try {
            // execute the transaction callback
            await fn();
          } catch (err) {
            // unset the transaction client when something goes wrong
            this.transactionContext.set(PRISMA_CLIENT_KEY, null);
            throw err;
          }
        });
      });
    }
  }
}
```

You can see that the Transaction Client is created inside this class and is saved inside the CLS namespace. Hence, the repositories who want to use the Prisma Client can retrieve it from the CLS indirectly.

Is this it? Actually, no. There's one more point you have to be careful when using transactions in Prisma. It's that the `prisma` instance inside the transaction callback has different types than the original `prisma` instance. You can see this in the type definitions:

```ts
export type TransactionClient = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use'>
```

Be aware that the `$transaction` method is being `Omit`ted. So, you can see that at this moment you cannot create nested transactions using Prisma.

To deal with this, I've created a `PrismaClientManager` which returns a Transaction Prisma Client if it exists, and if not, returns the original Prisma Client. Here's the implementation:

```ts
export class PrismaClientManager {
  private prisma: PrismaClient;
  private transactionContext: cls.Namespace;

  constructor(prisma: PrismaClient, transactionContext: cls.Namespace) {
    this.prisma = prisma;
    this.transactionContext = transactionContext;
  }

  getClient(): Prisma.TransactionClient {
    const prisma = this.transactionContext.get(
      PRISMA_CLIENT_KEY
    ) as Prisma.TransactionClient;
    if (prisma) {
      return prisma;
    } else {
      return this.prisma;
    }
  }
}
```

It's simple, but notice that the return type is `Prisma.TransactionClient`. This means that the Prisma Client returned from this `PrismaClientManager` always returns the `Prisma.TransactionClient` type. Therefore, this client cannot create a transaction.

This is the constraint I made in order to achieve this cross module transaction using Prisma. In other words, you cannot call `prisma.$transaction` from within repositories. Instead, you always use the `TransactionScope` class I mentioned above.

It will create transactions if needed, and won't if it isn't necessary. So, from repositories, you can write code like this:

```ts
export class PrismaOrderRepository implements OrderRepository {
  private readonly clientManager: PrismaClientManager;
  private readonly transactionScope: TransactionScope;

  constructor(
    clientManager: PrismaClientManager,
    transactionScope: TransactionScope
  ) {
    this.clientManager = clientManager;
    this.transactionScope = transactionScope;
  }

  async create(order: Order): Promise<void> {
    // you don't need to care if you're inside a transaction or not
    // just use the TransactionScope
    await this.transactionScope.run(async () => {
      const prisma = this.clientManager.getClient();
      const newOrder = await prisma.order.create({
        data: {
          id: order.id,
        },
      });

      for (const productId of order.productIds) {
        await prisma.orderProduct.create({
          data: {
            id: uuid(),
            orderId: newOrder.id,
            productId,
          },
        });
      }
    });
  }
}
```

If the repository is used inside a transaction, no transaction will be created again (thanks to the `PrismaClientManager`). If the repository is used outside a transaction, a transaction will be created and consistency will be kept between the `Order` and `OrderProduct` data.

Finally, with the power of the `TransactionScope` class, you can create a transaction from the application layer as follows:

```ts
export class CreateOrder {
  private readonly orderRepo: OrderRepository;
  private readonly notificationRepo: NotificationRepository;
  private readonly transactionScope: TransactionScope;
  constructor(
    orderRepo: OrderRepository,
    notificationRepo: NotificationRepository,
    transactionScope: TransactionScope
  ) {
    this.orderRepo = orderRepo;
    this.notificationRepo = notificationRepo;
    this.transactionScope = transactionScope;
  }

  async execute({ productIds }: CreateOrderInput) {
    const order = Order.create(productIds);

    // create a transaction scope inside the Application layer
    await this.transactionScope.run(async () => {
      // call multiple repository methods inside the transaction
      // if either fails, the transaction will rollback
      await this.orderRepo.create(order);
      await this.notificationRepo.send(
        `Successfully created order: ${order.id}`
      );
    });
  }
}
```

Notice that the `OrderRepository` and `NotificationRepository` are inside the same transaction and therefore, if the Notification fails, you can rollback the data which was saved from the `OrderRepository` (leave the architecture decision for now 😂. you get the point.). Therefore, you don't have to mix the database responsibilities with the notification responsibilities.

## Wrap up

I've shown how you can create a TransactionScope using Prisma in Node.js. It's not ideal, but looks like it's working as expected. I've seen people struggling about this architecture and hope this post comes in some kind of help.

Feedbacks are extremely welcome!

[kenfdev/prisma-auto-transaction-poc](https://github.com/kenfdev/prisma-auto-transaction-poc)
