---
title: "Continuously Enforce Policies on Your Configs with Conftest and CircleCI"
date: "2019-10-22"
description: "Learn how to use conftest-orb to continuously enforce policies on your configuration files in CircleCI pipelines using Open Policy Agent and Rego."
tags: ["OPA", "Rego", "Conftest", "CircleCI", "CI/CD"]
lang: "en"
---

I'm assuming many engineers have struggled to enforce some kind of policy (e.g. style guides, best practices) on their structured data (especially configuration data). Code linting tools do a really good job in this area (e.g. eslint, golangci-lint, etc.) and I can't imagine working with colleagues without linters any more. What I wanted was to have a similar experience with my configurations such as YAML files and remembered watching a very interesting presentation at KubeCon called "Unit Testing Your Kubernetes Configuration with Open Policy Agent" by [@garethr](https://twitter.com/garethr):

[Unit Testing Your Kubernetes Configuration with Open Policy Agent - Speaker Deck](https://speakerdeck.com/garethr/unit-testing-your-kubernetes-configuration-with-open-policy-agent)

Conftest and [Open Policy Agent](https://openpolicyagent.org) are the key points here.

[instrumenta/conftest](https://github.com/instrumenta/conftest)

[open-policy-agent/opa](https://github.com/open-policy-agent/opa)

If you are new to [Conftest](https://github.com/instrumenta/conftest) and [Open Policy Agent](https://github.com/open-policy-agent/opa), here is an interesting read written by [@LennardNL](https://twitter.com/LennardNL/):

* [Validating Terraform plans with the Open Policy Agent](https://www.blokje5.dev/posts/validating-terraform-plans/)
* [Building in compliance in your CI/CD pipeline with conftest](https://www.blokje5.dev/posts/compliance-in-cicd/)

I'm not digging into details about Conftest and Open Policy Agent in this post, so I definitely recommend reading the posts above (otherwise, this post might not make any sense to you).

What I wanted to do is continuously enforce my policies in [CircleCI](https://circleci.com). Also, since I use CircleCI in vast amounts of projects, I wanted to easily be able to use it inside my CI and without polluting my `circleci/config.yml`. As a result, I made a CircleCI Orbs for conftest called, without surprise, [conftest-orb](https://circleci.com/orbs/registry/orb/kenfdev/conftest-orb).

Let me show how you can use this in the further sections of this post.

## Overview

The simplest CircleCI config YAML for conftest-orb would look like this:

```yaml
version: 2.1
orbs:
  conftest: kenfdev/conftest-orb@x.y
workflows:
  build:
    jobs:
      - conftest/test:
          pre-steps:
            - checkout
          file: config_to_test.yaml
```

Note that there are some prerequisites in order for this pipeline to work such as the following:

* `config_to_test.yaml` is in the root of your repository
* You have the Rego policies in a directory called `policy`

With the above in mind, this CircleCI workflow will enforce your policy on `config_to_test.yaml`. Simple isn't it?

## Example with serverless.yaml

I've created an example with the [Serverless Framework](https://serverless.com) YAML which I just copied from the [conftest examples](https://github.com/instrumenta/conftest/tree/master/examples/serverless) and integrated with CircleCI:

[kenfdev/conftest-serverless-circleci](https://github.com/kenfdev/conftest-serverless-circleci)

Let's take a look at the `.circleci/config.yml`:

```yaml
version: 2.1
orbs:
  conftest: kenfdev/conftest-orb@0.0.8
workflows:
  build:
    jobs:
      - conftest/test:
          pre-steps:
            - checkout
          file: serverless.yaml
```

You can see how the prerequisites explained above are satisfied with the following file structure:

```bash
kenfdev/conftest-serverless-circleci
├── policy
│   ├── base.rego
│   └── util.rego
└── serverless.yaml
```

The `serverless.yaml` which will be under test looks like this:

```yaml
service: aws-python-scheduled-cron

frameworkVersion: '>=1.2.0 <2.0.0'

provider:
  name: aws
  runtime: python2.7
  tags:
    author: 'this field is required'

functions:
  cron:
    handler: handler.run
    runtime: python2.7
    events:
      - schedule: cron(0/2 * ? * MON-FRI *)
```

I'm not going into details about the [rego files](https://github.com/kenfdev/conftest-serverless-circleci/blob/master/policy/base.rego) but the policies which are going to be enforced are as follows:

* Should set `provider` `tags` for author
* Python 2.7 cannot be the default `provider` `runtime`
* Python 2.7 cannot be used as the `runtime` for `functions`

You can see how the first policy is satisfied, but the latter two aren't. Hence, when the CircleCI runs it will fail and you'll see something like the following screen:

![Alt Text](https://thepracticaldev.s3.amazonaws.com/i/eomks05bqoz21td214nr.png)

## Centralizing your Rego policies

Looking good! But wait a minute. Keeping the policies inside every single repository doesn't seem like a good idea (I can smell something DRY...). But fear not, this is also an area where conftest shines. With the power of [push and pull](https://github.com/instrumenta/conftest#configuration-and-external-policies), conftest can save and load **external policies** from OCI registries. I'm no expert in OCI registries, but I know that the [Docker Registry](https://hub.docker.com/_/registry) is OCI compatible.

Since I don't want to pay for a self-hosted Docker Registry (at least for now), I've came up with a hack to embed the policies inside the container image via CircleCI. Here's the repository where I save policies for the CircleCI orb YAML in order to enforce [best practices mentioned in the docs](https://circleci.com/docs/2.0/orbs-best-practices/#orb-best-practices-guidelines):

[kenfdev/conftest-circleci-orb-policies](https://github.com/kenfdev/conftest-circleci-orb-policies)

I'm not digging into details here either but the following diagram is a rough picture of how the Docker Registry Image gets built in the CI (and here's the [config](https://github.com/kenfdev/conftest-circleci-orb-policies/blob/master/.circleci/config.yml)):

![Alt Text](https://thepracticaldev.s3.amazonaws.com/i/66bhgmwixtjsfwak1zvc.png)

Now that I have an OCI registry which includes policies out of the box, I can use them from the CircleCI orbs. The cool thing about `conftest-orb` development is that in each CI, I'm running integration tests to test the features of the orb, and **at the same time** I'm enforcing the CircleCI best practices on the `orb.yml`! It's a pretty cool developer experience to be able to dogfood your project inside the CI.

The following is how the orbs' integration test looks like (full code [here](https://github.com/kenfdev/conftest-orb/blob/c151f1914d1c3025985b5640716e3e6b5139debc/.circleci/config.yml#L66-L85)):

```yaml
jobs:
  general_usecase_test:
    executor: machine
    steps:
      - checkout
      - circleci-cli/install
      - run:
          name: Pack the orb.yml
          command: circleci config pack src > orb.yml
      - conftest/install
      # start the OCI registry(this command is declared in a different place)
      - start_oci_registry:
          image: kenfdev/circleci-orbs-policies
      # pull the policies from the OCI registry
      - conftest/pull:
          policy_path: policy
          repository: 127.0.0.1:5000/policies:latest
      # test with minimum options
      - conftest/test:
          policy_path: policy
          file: orb.yml
```

It looks a bit verbose but that is because I need to spin up the Docker Registry in the CI. If you already have an OCI registry running outside, all you have to write is something like this:

```yaml
version: 2.1
orbs:
  conftest: kenfdev/conftest-orb@0.0.8
workflows:
  build:
    jobs:
      - conftest/test:
          pre-steps:
            - checkout
          repository: <path-to-your-oci-registry>
          file: serverless.yaml
```

This will pull your policies from `<path-to-your-oci-registry>` and run `conftest` to on the `file`.

Thanks to the OCI registry feature, I can now create several CircleCI orbs and enforce the same policy to all of them via this `conftest-orb`. Isn't this pretty awesome? Let's wrap up!

## Wrap up

In this post I showed how you can enforce policies in your CircleCI pipeline using conftest orbs. By using the orbs you can easily start enforcing policies to your structured data. IMHO, sharing policies is still a bit tricky but there is an interesting PR waiting to be merged here:

[conftest/pull/107 - Add http/https/s3/gcs/git getters](https://github.com/instrumenta/conftest/pull/107)

If this gets merged, conftest will be able to fetch policies via `http/https/s3/gcs/git/etc`, which will open a wide range of possibilities to centralize your Rego policies! This is going to be **REALLY** exciting!

### Open Policy Agent

Another important thing I haven't mentioned much in this post is [Open Policy Agent](https://openpolicyagent.org), the policy engine which Conftest uses under the hood. I really recommend taking a look at this project and getting your hands dirty with the [Rego language](https://www.openpolicyagent.org/docs/latest/#rego). It's a bit tricky at first but after you get used to it, the flexibility is extremely powerful.

You can join the super supportive community [here](https://slack.openpolicyagent.org). Also, there is a #conftest channel specific to Conftest.

### Try it yourself!

If you find this post interesting, please give [conftest-orb](https://circleci.com/orbs/registry/orb/kenfdev/conftest-orb) a try! Feedbacks will be greatly appreciated :)
