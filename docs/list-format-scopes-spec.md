# Who and where a list format applies

Formats on list cells and rows (`feat/list-meta`, Core 3.0.0-alpha.11)
currently have one setting and one audience: whoever sets a format sets
it for everyone, wherever the record appears. This adds two axes to
that, decided with John on 2026-10-31.

- **Who**: `Just me` (default) or `Everyone`. `Everyone` is what the
  feature does today.
- **Where**: `Just here` or `Everywhere` (default). `Everywhere` is what
  it does today.

Notes are unchanged. They are already per-user -- everyone's are
visible, only your own is editable -- so `Who` largely exists for them,
and `Where` for notes can wait until formats have been lived with.

No schema or catalog change: `meta` is `jsonb` and the catalog gives it
no shape, so this is a payload change only. Nothing to install, and no
views to rebuild.

## What the storage has to become

Today a format is a single slot per target, stamped with a `by` that
nothing reads:

```json
{
  "format": {
    "row":   {"background": "red", "bold": true, "by": "john", "at": "..."},
    "cells": {"qty": {"color": "green", "by": "john", "at": "..."}}
  }
}
```

`Just me` is what breaks that open: a private format is per-user, so the
slot becomes several, and `Where` multiplies it again by context. Each
target therefore holds a list of entries rather than one:

```json
{
  "format": {
    "row": [
      {"who": "all",  "where": "*",            "background": "red",  "by": "john", "at": "..."},
      {"who": "mine", "where": "sheet:fb1234", "bold": true,         "by": "ann",  "at": "..."}
    ],
    "cells": {
      "qty": [
        {"who": "mine", "where": "*", "color": "green", "by": "john", "at": "..."}
      ]
    }
  }
}
```

A list rather than nested maps because it migrates, prunes and filters
in one line each, and resolves by walking it in precedence order.

- `who` is `"all"` or `"mine"`.
- `where` is `"*"` for everywhere, or an opaque context key (below).
- `by` identifies the owner of a `mine` entry, and stays provenance on
  an `all` entry as it is today.
- An entry is unique per `(target, who, where)`, and per `by` as well
  when `who` is `"mine"`. Writing an entry replaces the matching one.

### Reading an old record

A legacy format is an object where this expects a list. The reader
treats a non-list as a single `{who: "all", where: "*"}` entry, which is
exactly what it meant. No migration script, and a database written by an
older server keeps working.

## Which format a cell shows

Two different rules, and the distinction matters:

**Across `who` and `where`, the most specific entry wins outright.**
Not layered. Walking a target's entries in this order and taking the
first match:

1. `mine` + `here`
2. `mine` + `everywhere`
3. `all` + `here`
4. `all` + `everywhere`

So if your private format sets only **bold** and a colleague's shared
format sets a **red background**, you see bold and no red. Your entry is
used whole and theirs is not consulted. This keeps "just me wins" a
statement someone can hold in their head, at the price of discarding a
colleague's red that you never said anything about -- John's call, and
the reason the dialog has to say when that is happening.

**Across targets, formats still layer property by property**, as they do
now: business style, then the winning row format, then the winning cell
format, each replacing only what it sets. A row format's background
still shows through a cell format that only sets bold.

So the stack per cell is three deep, not eight: one resolution step per
target, then the existing two-layer compose.

## Saying that a shared format is hidden

When the winner is a `mine` entry and an `all` entry exists for the same
target, the dialog says so on the `Who` row -- "Everyone also has a
format here" -- and switching to `Everyone` loads that format into the
editor, so the preview shows what everyone else is getting. Switching
back returns to yours. This falls out of how the dialog already works:
the `Apply to` radios call `load()` on change, and these do the same.

Not proposed yet: a mark in the grid itself. It would be more
discoverable than a line in a dialog nobody has opened, but the lead
column and the cell corner are already carrying a note icon and a note
marker, and the last round of this feature was about taking clutter
away. Worth deciding after the dialog has been used.

## What "here" is

The host supplies an opaque key when it has a durable one, as a new
`contextKey` option on the table widget. The server stores it and never
interprets it beyond a length and charset check.

| Where a list appears | Key | Notes |
| --- | --- | --- |
| Worksheet (`workbook-page.js`) | `sheet:<sheet.id>` | `sheet.id` is stable across renames |
| Child table on a form | none yet | See below |
| Search page, drill-down dialog, data list, the list on a user account | none | No identity that outlasts the moment |

Worksheets only, to begin with. A child table is built by the generic
widget builder in `core.js`, which hands `child-table.js` a parent view
model and a property name and knows nothing about which form it is
drawing, so a place would have to be threaded from the form through
`form-widget.js` and that builder. Worth doing, and worth doing on its
own rather than tacked onto this: a place reaching the wrong list is
worse than no place at all. Until then `Just here` is disabled on a
child table, which the design already accounts for.

Where the host gives no key, `Just here` is disabled with a tooltip
saying the list has no place of its own, and `Where` stays on
`Everywhere`. Better than inventing keys that outlive nothing.

## Defaults

`Who` defaults to `Just me`, as John asked: a format should not reach
other people unless it is meant to.

`Where` defaults to `Everywhere`, which is *not* symmetric with that on
purpose. The two axes are about different things. `Who` is blast radius
to other people, so the conservative default earns its keep. `Where` is
about your own experience of the same record, and a format usually means
something about the record itself -- this customer is trouble -- which
is worth having wherever the record turns up. It also leaves the `Where`
axis behaving as it does today. One line to change if that proves wrong
in use.

## Writing

`POST /do/meta` keeps its four actions and takes two more parameters on
`format` and `clearFormat`:

- `who`: `"all"` or `"mine"`, defaulting to `"all"`
- `where`: a context key or `"*"`, defaulting to `"*"`

The wire default is `"all"` even though the dialog's default is
`Just me`, which looks inconsistent and is not. An omitted parameter
should keep meaning what it meant before this change, and it should
land on the stricter authorization rather than the looser one. The
dialog sends `who` on every save, so the default is only ever reached
by a caller written against the older endpoint -- which meant `all`.

Authorization splits:

- `who: "all"` keeps requiring `canUpdate` on the record, as now. A
  shared format is a change to the record everyone reads.
- `who: "mine"` requires only that the user can read the record. A
  private colour is a view preference, and a user with read-only access
  to a list should still be able to mark it up for themselves.

`clearFormat` clears the one entry addressed by `(target, who, where)`,
for the calling user when `who` is `"mine"`. Nobody clears anyone
else's private format; a super user wanting a record clean can clear
the shared one.

The existing `MAX_META` guard now covers formats as well as notes, so
its message stops talking only about notes.

## Still to settle

- Other users' private formats ride along in `meta` to every client,
  because `meta` is read by the ordinary CRUD path and nothing filters
  it per user today -- the same as notes. Harmless, since it is colours
  rather than anything private, but it grows with the user count.
  Filtering means touching `crud.js`'s read path, which is worth doing
  deliberately rather than as part of this.
- Whether the grid should mark a cell whose shared format is hidden.
- `Where` for notes.

## Tests

Unit:

- The resolution table above, case by case, including a legacy object
  read as `all`/`everywhere`.
- Row-then-cell layering still partial, with the who/where resolution
  under it.
- The dialog's two new rows: defaults, tooltips, `load()` on change,
  the "Everyone also has a format here" line appearing only when it
  should, and `Just here` disabled with no context key.

API (`api/meta.test.js`):

- Writing and clearing each `(target, who, where)` combination.
- A user with read but not update rights can write and clear `mine`,
  and is refused `all`.
- Nobody clears another user's `mine`.
- A record carrying a legacy format object takes a new entry without
  losing the old one's meaning.
- The size guard.

The form-widget golden changes: the format dialog gains two rows.
