---
title: Policy enforcement with Vue.js and OPA WebAssembly
date: "2019-12-22"
description: "How to integrate OPA WebAssembly with Vue.js to enforce policies in the front-end using Rego."
tags: ["opa", "vue", "webassembly", "rego"]
lang: "en"
---

Recently, there was an exciting announcement from OPA about "Rego on WebAssembly".

[OPA v0.15.1: Rego on WebAssembly](https://blog.openpolicyagent.org/opa-v0-15-1-rego-on-webassembly-81c226c51be4)

As explained in the post above, this will open lots of possibilities to **enforce policies** to all kinds of places. One out of many I wanted to try was in the Front-end world, especially with a SPA like Vue.js. This post describes how I integrated OPA WebAssembly with Vue.js.

## TL;DR

If you want to jump right to a working example, here's the repo for the Proof of Concept.

[kenfdev/vue-opa-wasm](https://github.com/kenfdev/vue-opa-wasm)

## Prerequisites

* Basic knowledge about [Open Policy Agent](https://www.openpolicyagent.org/) and the [Rego Language](https://www.openpolicyagent.org/docs/latest/policy-language/)
* Basic knowledge about [Vue.js](https://vuejs.org/)

## Overview

What I did for this PoC is listed below:

* Create a Rego file and declare rules
* Create a `wasm` file from Rego files with the OPA CLI
* Prepare Vue.js to use `wasm` files
* Create and inject a `policy` instance inside Vue.js
* Use the `policy` instance inside Vue.js templates

Let's dig into details.

## Details

For simplicity, I've followed the [nodejs-app](https://github.com/open-policy-agent/npm-opa-wasm/tree/master/examples/nodejs-app) example to create the wasm but I'm going to briefly explain about it anyway.

### Create a Rego file and declare rules

The Rego for this example is extremely simple. The following is the code:

```
# example.rego
package example

default hello = false

hello {
    x := input.message
    x == data.world
}
```

It means the `hello` rule will be `true` if "The `message` key's `value` of the `input` equals the value of `data.world`".

### Create a `wasm` file from Rego files with the OPA CLI

After the Rego file has been created, the Wasm needs to be built using the OPA CLI. Compiling Rego files to Wasm is added in v0.15.1 of the OPA CLI so you need to download the version newer than that:

https://github.com/open-policy-agent/opa/releases

The actual command to build the Wasm file is as follows:

```
opa build -d example.rego 'data.example = x'
```

One thing to note is that, as [explained in the docs](https://www.openpolicyagent.org/docs/latest/wasm/#compiling-policies), you need to specify a `query` to be used for the Wasm at compile time. In this example, I have queried the entire `data.example` package.

If the compile succeeds, you will see a `policy.wasm` file in the path you executed the command.

Preparing the Wasm to be used in the front-end completes here. Next, we'll dive into how this can be integrated in Vue.js.

### Prepare Vue.js to use `wasm` files

At the moment, OPA provides a light-weight sdk to use Wasm wih JavaScript called [@open-policy-agent/opa-wasm](https://www.npmjs.com/package/@open-policy-agent/opa-wasm). In this library, you can pass a Wasm `ArrayBuffer` to load Rego policies to be used by JavaScript.

For simplicity, I decided to load the Wasm at build time of the Vue.js app, and have chosen to use the [arraybuffer-loader](https://www.npmjs.com/package/arraybuffer-loader) to load the wasm with the `import` syntax via webpack.

To add a loader for the Vue.js app, you'll need to create and modify a `vue.config.js` file as follows:

```js
// vue.config.js
module.exports = {
  chainWebpack: config => {
    config.module
      .rule('arraybuffer')
      .type('javascript/auto')
      .test(/\.wasm$/)
      .use('arraybuffer-loader')
      .loader('arraybuffer-loader');
  },
};
```

With this configuration, you can load the wasm like this in your JavaScript files:

```js
import wasm from './assets/policy.wasm'
```

> Note: Be sure to add the `type('javascript/auto')` line or else loading the wasm file will fail. [This issue](https://github.com/pine/arraybuffer-loader/issues/12#issuecomment-390834140) helped me solve it.

### Create and inject a `policy` instance inside Vue.js

Now that we have everything prepared, let's load the Wasm before we instantiate the Vue application.

```js
// ...

import Rego from '@open-policy-agent/opa-wasm';
import wasm from './assets/policy.wasm';

// ...

const rego = new Rego();
rego.load_policy(wasm).then(policy => {
  // add the policy instance to the Vue.prototype
  Vue.prototype.$policy = policy;

  new Vue({
    router,
    render: h => h(App),
  }).$mount('#app');
});
```

Fortunately, the `opa-wasm` SDK let's us easily load the Wasm as a policy instance by calling the `rego.load_policy` method. The promise returns a `policy` instance so I've added this instance to the `Vue.prototype` in order for it to be used in the Vue templates.

### Use the `policy` instance inside Vue.js templates

Here's an example on how we can use the `$policy` instance inside the Vue templates.

```html
<template>
  <div class="hello">
    <h1>{{ msg }}</h1>
    <pre>{{ $policy.evaluate({ message: "world" }) }}</pre>
  </div>
</template>

<script>
export default {
  name: "HelloWorld",
  props: {
    msg: String
  },
  created() {
    // set the data.world to "world"
    this.$policy.set_data({ world: "world" });
  }
};
</script>
```

I've set the `data.world` to `"world"` at the `created` life cycle of the component. And in the template itself, I'm calling `$policy.evaluate` with `input.message` set to `"world"`. Since both `data.world` and `input.world` have the same value `"world"`, the `hello` rule evaluates to `true`. You can check it out in the following screen capture.

![Image](https://i.imgur.com/WnymqcK.png)

## Wrap up

In this post, I've shown you how to build an OPA Wasm from a Rego file and use it inside a Vue application.  I used Vue.js in this post but anything JavaScript should be able to use the `policy` instance in the same way.

Being able to use the `policy` instance in the front-end is going to be extremely powerful. I can enforce policies nearly the same way in the front-end as I would in the back-end using the OPA server.

The application above is just a PoC to show you that using Rego policies in the front-end is **possible**. I can think of few things to improve at the moment such as:

#### Dynamically fetch wasm

I've imported the Wasm using the `import` statement but this won't scale. Perhaps one would like to prepare a Wasm per logged in user. It would probably be better to fetch the Wasm dynamically on the fly, and then load and convert it to a `policy` instance to be used.

#### Built-ins

At the time of writing, built-ins cannot be used in the Rego files unless you implement them by yourself. built-ins are extremely powerful and makes your Rego files more readable and performant. It would be nice to implement these in JavaScript to be used.

## Stay tuned!

The OPA Wasm is still in its early stages but is actively being developed. Let's keep an eye on the [official docs](https://www.openpolicyagent.org/docs/latest/wasm/) and the [Slack community](https://slack.openpolicyagent.org/)!