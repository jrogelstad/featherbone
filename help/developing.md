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

## Roles

*Not written yet.*
