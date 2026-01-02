---
title: "Deciphering GraphQL: A Deep Dive into Type Merging and Schema Stitching"
description: "A detailed walkthrough of GraphQL Type Merging in Schema Stitching, explaining how multiple schemas with the same types are merged at the gateway level."
date: "2023-09-27"
tags: ["GraphQL", "Schema Stitching", "Type Merging", "API Gateway"]
lang: "en"
---


Recently, I've been studying GraphQL Stitching, and no matter how many times I read about Type Merging, it didn't quite click. So, I made an effort to fully understand it.

The official documentation for Type Merging can be found here:

https://the-guild.dev/graphql/stitching/docs/approaches/type-merging

## Assumptions for this article

In this article, I won't be explaining what GraphQL Gateway or GraphQL Stitching are. 🙏 There are plenty of good articles explaining those aspects, so I recommend checking them out first.

For reference, the official documentation can be found here:

[https://the-guild.dev/graphql/stitching](https://the-guild.dev/graphql/stitching)

## Type Merging in GraphQL Stitching

### What is Type Merging?

To put it succinctly, Type Merging is a mechanism that allows us to treat multiple schemas defining the same type as if they were just one type.

For example, let's say there's a GraphQL Gateway, and behind it, there are GraphQL servers handling `manufacturers`, `products`, and `storefronts`.

![Image description](https://dev-to-uploads.s3.amazonaws.com/uploads/articles/5xi9ycgy7xze1noolnyf.png)

Although the servers are separate, you'll notice that types like `Product` and `Manufacturer` are defined on each. These can be merged, and the Gateway can provide the following schema:

```graphql
type Query {
  manufacturer(id: ID!): Manufacturer
  product(upc: ID!): Product
  _manufacturer(id: ID!): Manufacturer
  storefront(id: ID!): Storefront
}

type Manufacturer {
  id: ID!
  name: String!  # From the manufacturers schema
  products: [Product]!  # From the products schema
}

type Product {  # Mainly from the products schema
  upc: ID!
  name: String!
  price: Float!
  manufacturer: Manufacturer
}

type Storefront {  # From the storefronts schema
  id: ID!
  name: String!
  products: [Product]!
}
```

Up to this point, it's relatively intuitive, but the "How do we merge?" part felt somewhat elusive when I read the documentation. I kept reading and forgetting, so I decided to take a closer look at the official sample's inner workings.

https://github.com/ardatan/schema-stitching/tree/master/examples/type-merging-single-records

### Verifying the Merging Flow in practice

When you check the official documentation's [MergingFlow](https://the-guild.dev/graphql/stitching/docs/approaches/type-merging#merging-flow), there's a diagram and a description of each step, explaining how the merging happens.

![Image description](https://dev-to-uploads.s3.amazonaws.com/uploads/articles/cpd8mlg5furc529035z1.png)

The diagram slightly omits certain explanations, making it somewhat challenging to grasp at a glance.

Thus, I visualized the flow in more detail using the `Storefront`, `Product`, and `Manufacturer` examples. (For a fullscreen view, click [here](https://dev-to-uploads.s3.amazonaws.com/uploads/articles/rgncjo661hz1nq5mlcmg.png)).

![Image description](https://dev-to-uploads.s3.amazonaws.com/uploads/articles/rgncjo661hz1nq5mlcmg.png)

Let's go through the steps.

#### 1. Client request

The client sends a request.

![Image description](https://dev-to-uploads.s3.amazonaws.com/uploads/articles/s0retula7ofl6l411cxr.png)

Since the Gateway schema matches the one mentioned above, this is a regular GraphQL query, simply requesting the desired data.

#### 2. The original request goes to the storefront server

![Image description](https://dev-to-uploads.s3.amazonaws.com/uploads/articles/eprawoq5tmutj85f8y0p.png)

Next, since the request is intended for the storefront, it's sent there via the gateway. At this point, the gateway filters the query, **sending only the parts relevant to the storefront**. The storefront only understands the `Product` type with just the `upc`, so the original query's `name` and `manufacturer` are omitted.

![Image description](https://dev-to-uploads.s3.amazonaws.com/uploads/articles/fwkhfie4oqwoyhitkfml.png)

However, if we only had this, we'd lose the information we want to retrieve from the `products`, and we wouldn't be able to fetch data from the other servers. This is where `selectionSet` comes in. Citing the official documentation:

> selectionSet specifies one or more key fields required from other services to perform this query. Query planning will automatically resolve these fields from other subschemas in dependency order.

In essence, it's declaring, "To get data for type ○○, we at least need △△ information." In this case, the products server has a configuration like:

```js
merge: {
  Product: {
    // This service provides _all_ unique fields for the `Product` type.
    // Again, there's unique data here so the gateway needs a query configured to fetch it.
    // This config delegates to `product(upc: $upc)`.
    selectionSet: '{ upc }',
    fieldName: 'product',
    args: ({ upc }) => ({ upc }),
  },
},
```

You can see a `selectionSet` of `{ upc }`. It's declaring, "When merging data for the Product type, we need the `upc`." Having this information, the gateway implicitly adds `upc` when sending a request to the storefront server. Checking the actual query log confirms the presence of `upc`.

![Image description](https://dev-to-uploads.s3.amazonaws.com/uploads/articles/e6kg01mti4b6vyq96s07.png)

#### 3. Response from storefront

From the previous request, the response from the storefront is as follows:

![Image description](https://dev-to-uploads.s3.amazonaws.com/uploads/articles/en498ef7zyb75nr0g7m3.png)

#### 4. Creation of the merger query

Once the storefront responds, the next step is to send a request to the products server. Someone responsible for merging (let's call them the "merger") sends the query, utilizing the `merge` setting.

![Image description](https://dev-to-uploads.s3.amazonaws.com/uploads/articles/v84vcjvkzcp1cfobd6mr.png)

Here, the products server's `merge` setting specified for the gateway is in focus. Particularly, note the `fieldName` and `args`. This means that when merging the `Product` type, the server uses its `product` query, and for the argument, it uses the originating object's `upc` property.

It's a bit tricky, but the relationship is as shown below:

![Image description](https://dev-to-uploads.s3.amazonaws.com/uploads/articles/7fal0a7imutpv4cv5toj.png)

Using this information, the query for step 5 is generated.

#### 5. Request to the products

 server

Based on the information from step 4, a query is generated for the products server, which looks like this:

![Image description](https://dev-to-uploads.s3.amazonaws.com/uploads/articles/lg9bjlbttfxbfxo7uwkc.png)

Thanks to the `args` definition, the `upc` is injected with the value `6`.

From here on, it becomes repetitive, but only the query aspects that the products server can handle are filtered. The original query requested the `manufacturer's` `name` and `products`, but the products server isn't aware of the `name` property.

![Image description](https://dev-to-uploads.s3.amazonaws.com/uploads/articles/v1m293ovnz9cqc2maucs.png)

Thus, `name` is omitted.

For the `Manufacturer type`, there's a `selectionSet` of `{ id }` set for the manufacturer server, as seen below:

```js
merge: {
  // This schema provides one unique field of data for the `Manufacturer` type (`name`).
  // The gateway needs a query configured so it can fetch this data...
  // this config delegates to `manufacturer(id: $id)`.
  Manufacturer: {
    selectionSet: '{ id }',
    fieldName: 'manufacturer',
    args: ({ id }) => ({ id }),
  },
},
```

This is implicitly injected into the query, as can be seen from the actual request below:

![Image description](https://dev-to-uploads.s3.amazonaws.com/uploads/articles/hezz2bcqaq3w4z284v17.png)

#### 6. Response from products

From the previous request, the response from the products is as follows:

![Image description](https://dev-to-uploads.s3.amazonaws.com/uploads/articles/28aidy5lho88cl1qx58f.png)

#### 7,8,9. Similar requests are sent to the manufacturer server

I'll skip the details for the manufacturer server request, as it's repetitive. It looks like this (for a full view, click [here](https://dev-to-uploads.s3.amazonaws.com/uploads/articles/bcz4aiodb6pj2vx1i7dn.png)):

![Image description](https://dev-to-uploads.s3.amazonaws.com/uploads/articles/bcz4aiodb6pj2vx1i7dn.png)

#### 10,11. All results are merged into the appropriate type and returned

Finally, all the results are merged, and the client receives the response they requested.

![Image description](https://dev-to-uploads.s3.amazonaws.com/uploads/articles/gu0u8z9lhu3iq3l194um.png)

## Conclusion

After delving deeper than the official documentation, I feel like I've come to grasp Type Merging much better. I particularly had a hard time understanding `selectionSet`, but seeing the actual requests helped me understand its implicit injection.

While I only touched on a small part about GraphQL Gateway, I believe others might also struggle to understand Type Merging, so I hope this article helps someone out there.