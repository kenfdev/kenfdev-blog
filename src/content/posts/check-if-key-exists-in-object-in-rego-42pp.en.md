---
title: "Check if key exists in object in Rego"
date: "2019-10-01"
description: "A quick tip on how to check if a key exists in an object using Rego, and why the '_ = x[k]' syntax is necessary to handle false values correctly."
tags: ["OPA", "Rego", "Tips"]
lang: "en"
---

Recently, I'm writing [Rego](https://www.openpolicyagent.org/docs/latest/policy-language/#what-is-rego)(a query language to use in [Open Policy Agent](https://www.openpolicyagent.org/docs/latest/policy-language/#what-is-rego)) every day and have decided to post some tricky syntaxes that took me a little time to understand.

In this post, I'm going to look at **how to check if a key exists in an object** in Rego.

I've pulled the sample code from the [Policy Cheatsheet](https://www.openpolicyagent.org/docs/latest/policy-cheatsheet/#merge-objects) in the official docs.

```
has_key(x, k) { _ = x[k] }
```

Looks simple, but has a bit of a gotcha (at least for me) despite consuming the function is pretty intuitive (here's the [playground](https://play.openpolicyagent.org/p/Bd9VsdhB1n)):


```
has_key({"foo": "bar"}, "foo") # true
has_key({"foo": "bar"}, "baz") # undefined
```

It's checking if key `k` exists in object `x`. What confused me at first is `_ = x[k]`. Why do we need the `_ =` part?

### Without the "_ ="

Let's see what happens if the function becomes like this:

```
has_key(x, k) { x[k] }
```

At first, this looks like it's working. But you have to think about the case where the value of `x[k]` is **actually** `false`. 

The return value of the function is `true` whenever the function body is satisfied. That is the case when x[k] **unifies to anything** _that is not `false`_ -- if x[k] unifies to `false`, the function body is not satisfied... ([functions are not very different from rules](https://www.openpolicyagent.org/docs/latest/faq/#functions-versus-rules)). Here's an example(and the [playground](https://play.openpolicyagent.org/p/BlEybGlNId)):

```
has_key(x, k) { x[k] }

default foo_exists = false
foo_exists = has_key({"foo": false}, "foo") # false!!!
```

To avoid this unexpected behavior, the assigning(or union) part (`_ =`) is mandatory.

### With the "_ ="

Let's put the `_ =` back inside the function.

```
has_key(x, k) { _ = x[k] }
```

With this, the function body is satisfied if it unifies -- i.e. there's an x[k], not `undefined` -- but it **doesn't matter** if it's `true` or `false`, because the x[k] is put into a context where its value doesn't matter: `_ = y` never fails, regardless of the value of y, as long as y is **not** `undefined`.

Any other construct that doesn't regard the value would work as well. Here are some alternatives (which are not _better_, just _different_): 

https://play.openpolicyagent.org/p/eed4f2wVGS 

https://play.openpolicyagent.org/p/LgJo6T0tUz 

### Wrap up

Again, you can check the correct version in [this playground](https://play.openpolicyagent.org/p/Bd9VsdhB1n).

If you're still uncomfortable with the Rego syntax used inside the function, check out the [Policy Language#Variable Keys](https://www.openpolicyagent.org/docs/latest/policy-language/#variable-keys) section in the official docs. Also, you can check the Policy [Cheatsheet#Objects](https://www.openpolicyagent.org/docs/latest/policy-cheatsheet/#objects-1) section.

Happy Rego coding!

_P.S. I'd like to greatly appreciate @srenatus from the OPA community for reviewing my post and giving me accurate advice!_
