# Developing

## Modules

*Not written yet.*

## Forms

*Not written yet.*

## Feathers

*Not written yet.*

## Relations

*Not written yet.*

## Services

*Not written yet.*

## Routes

*Not written yet.*

## Styles

*Not written yet.*

## System print forms

*Not written yet.*

## Help files

Help travels with the module it documents. A module that has help carries
a `help` folder beside its manifest, holding Markdown pages and a
`help.json` saying which page answers for what:

```json
{
    "title": "Sell",
    "default": "sales-orders.md",
    "pages": [
        {"path": "sales-orders.md", "title": "Sales orders"}
    ],
    "forms": {"Sales Order": "sales-orders.md"},
    "feathers": {"SalesOrder": "sales-orders.md"}
}
```

`pages` is the module's contents list, in the order it should be read.
`forms` and `feathers` are what the Help button looks up.

Every module's `pages` together make the Contents the help window opens
on, which is how help that is about no particular worksheet -- how
workbooks, filters and settings work -- is read: Help on the account
menu, or the Contents button in the window.

A page may use pictures. Put them in the module's `help` folder beside
the page and name them relatively (`![A worksheet](images/worksheet.png)`);
they are served from the deployed version like the page itself.

The button looks for the form first and the feather second, because the
form is where a record's actions are and one feather can have several
forms: a sales order opened from the order desk and the same order opened
for billing are two forms, and each can have its own page. Nothing about
help is stored on a worksheet or a form, so a page is never out of date
with the configuration that was saved last year.

Help is served from the version of the module a database has deployed, so
two databases on different versions each read help that matches the
software they are running.

A customer's own help is a Help Link record that belongs to no module,
naming the form it supplements. It shows in the help window beside the
standard page, under the organization's own heading. A package deploy
writes only records that belong to a module, so a deploy can never
overwrite it.

## REST API reference

**About** (the Info button beside the bell) shows what the instance runs,
and its **REST API** button opens the instance's API reference. The page
is `/<db>/api`; the document behind it is `GET /<db>/openapi.json`, an
OpenAPI 3.0 document put together each time it is asked for from three
sources:

1. the framework's own `openapi.json`, at the root of the checkout;
2. every feather in the instance's catalog, which gets the paths the
   server mounts for it (`/data/<feather>`, `/data/<feather>/{id}` and
   `/data/<plural>`) and a schema of its own name;
3. the `openapi.json` beside the manifest of each module the instance
   deployed, read from the version deployed.

A module documents the routes in its `routes.json`, with the paths
written the same way and every one a `post`:

```json
{
    "openapi": "3.0.3",
    "info": {"title": "Sell", "version": "2.1.19"},
    "tags": [{"name": "Sales order actions"}],
    "paths": {
        "/close-sales-order": {
            "post": {
                "tags": ["Sales order actions"],
                "operationId": "doCloseSalesOrder",
                "summary": "Close sales orders",
                "requestBody": {"content": {"application/json": {
                    "schema": {"type": "object"}
                }}},
                "responses": {
                    "204": {"description": "Closed"},
                    "default": {"$ref": "#/components/responses/Error"}
                }
            }
        }
    }
}
```

The server prefixes each path with the module's name in spinal case, the
way the route is served (`/sell/close-sales-order`). A module may refer
to `#/components/responses/Error`, `#/components/schemas/Money` and any
feather by name (`#/components/schemas/SalesOrder`); schemas of its own
should carry the module's name (`SellKpi`) so they cannot clash. Tags
group under the module's name in the reference. A name that is taken
already is renamed, never lost.

## Roles

*Not written yet.*
