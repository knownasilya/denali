---
title: App Structure
---

# `app/`

Holds the majority of your application code. This is where your actual business
logic tends to live. All files in this folder are automatically loaded into the
container, and their directory name is used as the type (i.e. `app/foos/bar`
would be loaded into the container under `foo:bar`).

```txt
app/
  actions/
    application.js  <- base action class to extend from
  models/
    application.js  <- base model class to extend from
  serializers/
    application.js  <- base serializer class to extend from
```

## `app/application.js`

This file exports the root Application class used by your entire app. You
generally won't need to modify this file, it's typically advanced use cases
only.

# `config/`

Holds the declarative and executable configuration for your app. *.js files
(other than `environment.js` and `initializers/*`) in this folder will be
automatically loaded into the container under their filename (i.e.
`config/foo.js` will be loaded under `config:foo`).

Configuration files in Denali tend to be JS files that export a function which
returns the configuration object. This gives the app developer greater
flexibility in constructing configuration: it allows for inter-dependent values
(i.e. option a depends on the value of option b), and easily using enviornment
variables via `process.env`.

Third party addons can add their own configuration files this way as well.

## `config/environment.js`

This file holds the configuration that varies per environment (i.e. dev vs.
staging. vs prod database details).

## `config/middleware.js`

This file exports a function which is invoked with the application's Router as
it's first argument. It lets you add generic Connect-compatible middleware to
your application that will run _before_ the Router hands off to the appropriate
action.

## `config/routes.js`

You define your application's routes in this file. See the [Routing
guide](guides/routing) for more details.

# `test/`

The test suite for your app. See the [Testing guide](guides/testing) for more
details.
