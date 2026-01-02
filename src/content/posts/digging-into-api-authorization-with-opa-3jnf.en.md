---
title: "Digging into API Authorization with OPA"
date: "2019-07-02"
description: "Learn how to implement fine-grained API authorization using Open Policy Agent (OPA) by migrating from a traditional if-statement approach to a policy-as-code solution."
tags: ["OPA", "Authorization", "Go", "API", "Security"]
lang: "en"
---

I've recently been getting my hands on with [Open Policy Agent](https://www.openpolicyagent.org/) to find a way to gain a fine-grained permission control feature for my custom API service.

In this post I'm assuming you have at least heard what Open Policy Agent is. If you haven't, I definitely recommend watching the following presentations from [Torin Sandal](https://twitter.com/sometorin).

Intro: Open Policy Agent

[![Open Policy Agent Introduction](https://img.youtube.com/vi/CDDsjMOtJ-c/0.jpg)](https://www.youtube.com/watch?v=CDDsjMOtJ-c)

OPA is extremely powerful and flexible. You should take a look at some of the tutorials in the official docs starting from the, well, "[Get Started](https://www.openpolicyagent.org/docs/latest/get-started/)".

One tutorial I found very interesting is the [HTTP API Authorization](https://www.openpolicyagent.org/docs/latest/http-api-authorization/). I think many people have experienced API Authorization and have struggled all the `if` statements to **allow** or **deny** a user doing something.  With OPA, you can **delegate the decision outside of your code**.

"Delegate the decision outside?", at first, this was hard for me to imagine so I've decided to migrate an API from a non-OPA version to an OPA version.

## TL;DR

You can look at the full code in the [repository](https://github.com/kenfdev/opa-api-auth-go).

[kenfdev/opa-api-auth-go](https://github.com/kenfdev/opa-api-auth-go)

* You can run the OPA authorized API from [this branch](https://github.com/kenfdev/opa-api-auth-go/tree/add-opa) of the repository
* The diff of non-OPA version and OPA version can be found [here](https://github.com/kenfdev/opa-api-auth-go/pull/1/files)

## The API

The API we are going to use is based on the tutorial in the OPA official docs. The tutorial uses python but I've decided to build it with Go and with labstack's [echo](https://echo.labstack.com/) framework.

Here is the overview of the application (including the policies).

* Members are as follows:
  * Alice
  * Bob
  * Charlie
  * Betty
  * David
* Bob is Alice's manager and Betty is Charlie's manager. David belongs to the HR department.
* Users can view their own salary
* Managers can view their subordinates' salary
* HRs can view everybody's salary

Here is an overview diagram.

![](https://thepracticaldev.s3.amazonaws.com/i/9z9ulzctqcwwv4hb4006.png)

Let's get started with the non-OPA version.

## The Policy Decision without OPA

I've created a Policy Enforcement middleware to enforce the policy on every request made to the API endpoint. In the middleware, I'm simply asking a `PolicyGateway` to check if the requester is allowed to call the API. The code below shows the overview.([GitHub](https://github.com/kenfdev/opa-api-auth-go/blob/40408e7b5b4d99df9e98d12e92de9cd503403919/middleware/policyenforcer.go#L14-L24))

```go
...
logrus.Info("Enforcing policy with middleware")

allow := gateway.Ask(c)

if allow {
	logrus.Info("Action is allowed, continuing process")
	return next(c)
} else {
	logrus.Info("Action was not allowed, cancelling process")
	return c.String(http.StatusForbidden, "Action not allowed")
}
...
```

The interface for `PolicyGateway` is just 1 method `Ask` which returns a `bool` meaning Allow or Deny.

```go
type PolicyGateway interface {
	Ask(echo.Context) bool
}
```

I've called the implementation for the gateway the `PolicyLocalGateway` and basically the following code is what it does.([GitHub](https://github.com/kenfdev/opa-api-auth-go/blob/master/gateway/policy.go#L25-L82).

```go
func (gw *PolicyLocalGateway) checkGETSalary(c echo.Context, claims *entity.TokenClaims) bool {
	userID := c.Param("id")

	if yes := gw.checkIfOwner(userID, claims); yes {
		logrus.Info("Allowing because requester is the owner")
		return true
	}

	if yes := gw.checkIfSubordinate(userID, claims); yes {
		logrus.Info("Allowing because target is a subordinate of requester")
		return true
	}

	if yes := gw.checkIfHR(claims); yes {
		logrus.Info("Allowing because requester is a member of HR")
		return true
	}

	logrus.Info("Denying request")
	return false
}
```

You can see lots of `if` statements and can assume this will easily increase the amount of code in the long run. Also, it is a little hard to understand what is going on with all these `if` statements and indentation (well... that might be my fault, but you get the point).

Let's check some HTTP requests to see what happens.

First, let's start with Alice. Since Alice is a normal staff, she can only view her own salary.

```bash
$ curl -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwiaWF0IjoxNTE2MjM5MDIyLCJ1c2VyIjoiYWxpY2UiLCJzdWJvcmRpbmF0ZXMiOltdLCJociI6ZmFsc2V9.WTR-Or-vS1yFBFHk7UyqZxsNhtTNSWeazJ57SJ7V4qY" \
  http://localhost:1323/finance/salary/alice

100
```

You can see that the value `100` came back with no errors. Let's see if Alice can view Bob's salary.

```bash
$ curl -H "Authorization: Bearer <Alice's JWT>" \
  http://localhost:1323/finance/salary/bob

Action not allowed
```

It is now forbidden because Alice is a normal staff and cannot view other employee's salary. The logs show the request has been denied as well.

```bash
app_1  | msg="Enforcing policy with middleware"
app_1  | msg="Checking GET salary policies" claims="&{alice [] false { 0  1516239022  0 1234567890}}" userID=bob
app_1  | msg="Denying request"
app_1  | msg="Action was not allowed, cancelling process"
```

On the other hand, let's see if Bob can view Alice's salary.

Bob's JWT payload looks like the following:

```json
{
  "sub": "1234567890",
  "iat": 1516239022,
  "user": "bob",
  "subordinates": ["alice"],
  "hr": false
}
```

He has `alice` as his subordinate which means he is Alice's manager.

```bash
$ curl -H "Authorization: Bearer <Bob's JWT>" \
  http://localhost:1323/finance/salary/alice

100
```

You can confirm that Bob is allowed to view Alice's salary. This is checked in the logic `gw.checkIfSubordinate` in the code above. Now how about Bob viewing David's salary?

```bash
$ curl -H "Authorization: Bearer <Bob's JWT>" \
  http://localhost:1323/finance/salary/david

Action not allowed
```

Of course, Bob is not allowed to view David's salary because he has no permission to do so.

Now, let's see what David as a member of HR can do?

David's JWT payload is as follows.

```json
{
  "sub": "1234567890",
  "iat": 1516239022,
  "user": "david",
  "subordinates": [],
  "hr": true
}
```

Since he is a member of HR, he has `hr: true` in his JWT payload.

```bash
$ curl -H "Authorization: Bearer <David's JWT>" \
  http://localhost:1323/finance/salary/bob

200
```

Success! And he can also see Betty, Alice, Charlie's salary as well. This is because he passes the check `gw.checkIfHR` in the code above.

This should have been pretty straight forward. Now, let's see what happens when OPA comes into the game.

## The Policy Decision with OPA

Adding OPA is pretty simple. The implementation of the `PolicyGateway` will change. I've called it the `PolicyOpaGateway` and this time, I didn't implement anything related to policy rules (none of those `if` statements anymore) because I wanted to **delegate** them to OPA.

The main changes are:

* I wrote policies in Rego to `*.rego` files
* I added the OPA server next to the main app
* I have implemented the `PolicyGateway` to make an external HTTP request to the OPA server with enough payloads in order for OPA to make decisions

### Writing the policy in Rego

The policy written in Rego is as below.

```rego
package httpapi.authz

# io.jwt.decode_verify
# https://www.openpolicyagent.org/docs/latest/language-reference/#tokens
token = t {
  [valid, _, payload] = io.jwt.decode_verify(input.token, { "secret": "secret" })
  t := {
    "valid": valid,
    "payload": payload
  }
}

default allow = false

# Allow users to get their own salaries.
allow {
  token.valid

  some username
  input.method == "GET"
  input.path = ["finance", "salary", username]
  token.payload.user == username
}

# Allow managers to get their subordinate's salaries.
allow {
  token.valid

  some username
  input.method == "GET"
  input.path = ["finance", "salary", username]
  token.payload.subordinates[_] == username
}

# Allow HR members to get anyone's salary.
allow {
  token.valid

  input.method == "GET"
  input.path = ["finance", "salary", _]
  token.payload.hr == true
}
```

It is nearly identical with the [tutorial version](https://www.openpolicyagent.org/docs/latest/http-api-authorization/). A slight difference is that it is verifying the JWT token with `io.jwt.decode_verify` using the key `secret`.

#### Side Note: The Rego Playground

One awesome feature I want to point out about OPA is the [Rego Playground](https://play.openpolicyagent.org/).

![](https://thepracticaldev.s3.amazonaws.com/i/mqrb9d6ohgfqwm3x50iy.png)

You can write policies and quickly evaluate them on the browser! In addition, you can share the policy via a link for others to look at (e.g. they can debug your policies). Here's the link for the policy above. The Input is set to Alice's JWT and the path to her own salary.

https://play.openpolicyagent.org/p/ww8qdEHdn0

You can check the OUTPUT to see that the result is allowed.

### Adding the OPA server

After creating a policy with Rego, I've set the OPA service next to the main app by adding the following lines in the [docker-compose.yml](https://github.com/kenfdev/opa-api-auth-go/blob/add-opa/docker-compose.yml#L11-L17).

```yaml
  pdp:
    image: openpolicyagent/opa:0.12.0
    ports:
      - 8181:8181
    volumes:
      - ./opa:/etc/opt/opa
    command: ["run", "--server", "/etc/opt/opa/authz.rego"]
```

> FYI, PDP stands for Policy Decision Point. I just wanted to give it a generic name.

### Requesting OPA for decisions

Now that OPA is ready, I have implemented the `PolicyGateway` so it makes an external HTTP request to OPA server for decisions.

#### Preparing the input

OPA needs enough information in order to make decisions. For this simple app, I needed to tell OPA:

* Who the requester is - including attributes (JWT token)
* What endpoint was requested (request path and HTTP method)

And the code looks like this. I have used echo's [JWT middleware](https://echo.labstack.com/middleware/jwt) to easily extract the JWT data.

```go
...
token := c.Get("token").(*jwt.Token)
// After splitting, the first element isn't necessary
// "/finance/salary/alice" -> ["", "finance", "salary", "alice"]
paths := strings.Split(c.Request().RequestURI, "/")[1:]
method := c.Request().Method

// create input to send to OPA
input := &opaInput{
	Token:  token.Raw,
	Path:   paths,
	Method: method,
}
// don't forget to wrap it with `input`
opaRequest := &opaRequest{
	Input: input,
}
...
```

A slight gotcha is that the HTTP request payload needs to be wrapped with an `input` key as shown in the code above. Of course, this is mentioned in the [docs](https://www.openpolicyagent.org/docs/latest/rest-api/#get-a-document-with-input).

#### HTTP Request

I have injected OPA's endpoint to the PolicyGateway through an environment variable ([here](https://github.com/kenfdev/opa-api-auth-go/blob/add-opa/docker-compose.yml#L10) and [here](https://github.com/kenfdev/opa-api-auth-go/blob/add-opa/main.go#L17-L18)). Therefore, it is accessible by calling `gw.endpoint`. So the request will be like the following code.([GitHub](https://github.com/kenfdev/opa-api-auth-go/blob/add-opa/gateway/policy.go))

```go
type opaResponse struct {
    Result bool `json:"result"`
}

...

// request OPA
resp, err := http.Post(gw.endpoint, "application/json", bytes.NewBuffer(requestBody))
...
body, err := ioutil.ReadAll(resp.Body)
...
var opaResponse opaResponse
err = json.Unmarshal(body, &opaResponse)
```

It's simply asking OPA and returning the result back to the caller. Now that the code is prepared, let's give it a shot again!

```bash
# David (a member of HR) viewing Betty's salary
$ curl -H "Authorization: Bearer <David's JWT>" http://localhost:1323/finance/salary/betty

200
```

Looks good. Let's look at the logs.

```bash
app_1  | msg="Enforcing policy with middleware"
app_1  | msg="Requesting PDP for decision" method=GET path="[finance salary betty]" token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwiaWF0IjoxNTE2MjM5MDIyLCJ1c2VyIjoiZGF2aWQiLCJzdWJvcmRpbmF0ZXMiOltdLCJociI6dHJ1ZX0.TBXtM_p-VIlgx9NSLn4An6hELr2UB3CrqHUJmofQorM
pdp_1  | l":"info","msg":"Sent response.","req_id":2,"req_method":"POST","req_path":"/v1/data/httpapi/authz/allow","resp_bytes":15,"resp_duration":4.1901,"resp_status":200,"time":"2019-06-30T14:29:52Z"}
app_1  | msg=Decision result=true
app_1  | msg="Action is allowed, continuing process"
app_1  | msg="Processing salary request" id=betty
app_1  | msg="Fetched salary" id=betty salary=200
```

The app is requesting OPA and receiving `true` as the result. You can see the same result in the following playground.

https://play.openpolicyagent.org/p/w0kohf47we

Let's also see if Alice's request to Bob (to her manager) will fail.

```bash
$ curl -H "Authorization: Bearer <Alice's JWT>" \
  http://localhost:1323/finance/salary/bob

Action not allowed
```

Awesome! And the logs?

```bash
app_1  | msg="Enforcing policy with middleware"
app_1  | msg="Requesting PDP for decision" method=GET path="[finance salary bob]" token=<Alice's JWT>
pdp_1  | l":"info","msg":"Received request.","req_id":1,"req_method":"POST","req_path":"/v1/data/httpapi/authz/allow","time":"2019-06-30T21:29:59Z"}
app_1  | msg=Decision result=false
app_1  | msg="Action was not allowed, cancelling process"
```

Everything is working as expected! (Here's the [playground](https://play.openpolicyagent.org/p/j1xmddfd9R))

We have successfully replaced the local policy engine to OPA. You can see how the separation of concerns are met by delegating the policy decisions to OPA.

You can view the full changes to the code in [my PR here](https://github.com/kenfdev/opa-api-auth-go/pull/1/files).

## Wrap up

This was a very simple example to show how you can leverage the power of OPA with an HTTP API server.

Some Pros and Cons I can think of from this simple example is:

**Pros**
Separation of concerns. In my main app, I can concentrate on the business logic I need to implement. I don't have to write all those `if` statements and change my code each time a policy changes. If I change my code, that means I have to deploy it again. As for OPA, you can dynamically change your policies on the run. No redeploying is necessary when you change policies.

In addition, I was not able to mention it in this post, but Rego can be tested with Rego, too. You should have a look at "[How Do I Test Policies?](https://www.openpolicyagent.org/docs/latest/how-do-i-test-policies/)".

Some additional Pros I've heard in the slack channel are as follows:

* Security/Compliance can audit policy separate from auditing the code.
* Consistent logging of decisions; helpful for SIEM integration ([Decision Logs](https://www.openpolicyagent.org/docs/latest/decision-logs/))
* Consistent policy language (Rego) across different microservices; helps people trying to understand what is actually authorized across a chain of services
* When building a UI, it also needs to implement the same policies; easier if decoupled and consistent across services (e.g. take a look at Chef Automate's [Introspection](https://github.com/chef/automate/tree/master/components/authz-service#introspection-how-to-query-permissions))
* Start with a solution purpose-built where you can start simple but that grows with you as your authz needs evolve.
* Avoid a series of one-off extensions to an authz system that in the end looks like a frankenstein. You can see how the monolith app I built above will become like in the long run.

**Cons**
I don't see a major downside in using OPA, but as this post has shown, a standard monolithic service turned into a microservice approach. Which means it will add complexity than not using OPA. But this is more about microservices than OPA itself. Also, Rego is an additional learning curve for newbies. I'd say it's worth the effort and I'm assuming Rego is going to become more and more popular as OPA grows.

Finally, some questions that may arise are:

**Do I have to pass all information to OPA for decisions?**
AFAIK, the simplest approach is to pass everything, but that may not be easy or performant in many situations. One way is to use the [http.send built-in function](https://www.openpolicyagent.org/docs/latest/language-reference/#http) to make external request from within OPA. You can also use [Bundles](https://www.openpolicyagent.org/docs/latest/bundles/) for OPA to fetch data periodically from external services. Further information can be found in the official docs "[Guides: Identity and User Attributes](https://www.openpolicyagent.org/docs/latest/guides-identity/)". It has really good detail in it.

**Can I use OPA as a library?**
Maybe you don't want an extra container for various reasons. Yes, OPA can be used as a Go library and you can look at some awesome OSS projects that use OPA as a library. Some that I know are:

* [Chef Automate](https://automate.chef.io/) ([GitHub](https://github.com/chef/automate/tree/master/components/authz-service/engine/opa))
* [ory/keto](https://www.ory.sh/docs/keto/) ([GitHub](https://github.com/ory/keto/tree/master/engine/ladon))
* [conftest](https://github.com/instrumenta/conftest)

**Can I create something like an AWS IAM with OPA?**
I have heard this question several times (including myself) in the OPA slack and if you have the same question, you should definitely look at the [Chef Automate authorization service documentation](https://github.com/chef/automate/tree/master/components/authz-service). This document is amazing. I really mean it. There are definitely many ways to implement something like an AWS IAM with OPA but this one is surely a great live example.

I'm assuming there are many more questions, but the best way to get support is to join the [OPA slack channel](https://slack.openpolicyagent.org/). The people there are super supportive and I've gained a lot of knowledge there.

Thank you for reading this long post!!! I'd like to greatly appreciate Ash([@ashtalk](https://twitter.com/ashtalk)) and Tim([@tlhinrichs](https://twitter.com/tlhinrichs)) for reviewing this post upfront! I'm hoping I can contribute and give back with what I have to the OPA community!

## Reference

* Deep Dive: Open Policy Agent

[![Deep Dive: Open Policy Agent](https://img.youtube.com/vi/Vdy26oA3py8/0.jpg)](https://www.youtube.com/watch?v=Vdy26oA3py8)
