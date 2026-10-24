# scripts/dev

Developer tools that change data. Nothing here is installed, deployed or run by
the framework: no manifest lists these files, the installer never sees them, and
the server never reads them. They exist to be run by hand, by a developer, on a
database they are willing to lose.

| File | What it does |
| --- | --- |
| `clear-instance-data.sql` | Empties the application master-data and transaction tables of one instance, leaving the Featherbone control tables (`$workbook`, `$settings`, `$feather`, forms, routes, scripts, roles, users) intact, so the packages still work. |
| `load.js` | Runs a data script against one instance, optionally clearing it first. Warns, asks, and refuses to run a file that is not marked as a data script. |
| `demo-data/teardrop-campers.sql` | A year of Road Runner Campers trading history plus the current open order book, built from the ddom "Teardrop Campers" demo dataset. 181,553 rows, anchored to a date you choose. |

## Running them

```
npm run dev:load -- --list
npm run dev:load -- --clear --script scripts/dev/demo-data/teardrop-campers.sql --db demo
```

Stop the server first: the clear step refuses to run while other connections are
open on the database. Connection settings come from `server/config.json` and the
environment, as everywhere else. The data scripts are run through `psql`, which
has to be on the `PATH`; they are ordinary SQL files, so you can also run one by
hand:

```
psql -d demo -v ON_ERROR_STOP=1 -f scripts/dev/demo-data/teardrop-campers.sql
```

`--dry-run` shows the plan and the clear step's full report and changes nothing.
Use it first.

## Dates and the anchor

`teardrop-campers.sql` carries ddom's own dates, where "today" is **2027-02-01**,
and shifts them all on the way in. Out of the box it anchors to **2027-07-05** —
mid-2027, so January to June are complete in the books, which is the shape a
historical summary wants. Move it per load:

```
npm run dev:load -- --anchor 2028-02-01 --script scripts/dev/demo-data/teardrop-campers.sql --db demo
PGOPTIONS="-c featherbone.load_anchor=2028-02-01" psql -d demo -f scripts/dev/demo-data/teardrop-campers.sql
```

`--anchor 2027-02-01` gives ddom's dates unshifted. Every date and timestamp moves
together — history, open book, operation schedules, inventory — so the data stays
consistent at any anchor, and the load says which anchor it used. A shift that is
not a whole number of weeks also says so, because the weekly batching then falls on
a different weekday.

**The seasons are the catch.** ddom's demand is seasonal the way a camper maker's
is: in its own dates it peaks in June (154 order lines) and bottoms out in December
(40). The default 154-day shift moves that peak to November and the trough to May,
so at the default anchor the business appears to sell most of its campers going
into winter. Only a shift of a whole number of years keeps the seasons where they
belong, and ddom's history ends in January, so no such shift puts "today" mid-year
— the two cannot both be had. If the seasons matter more than the mid-year position
for what you are building, `--anchor 2028-02-01` is the same data twelve months on
with the seasons intact and "today" in early February.

## How the work orders are built

The work orders are not copied from ddom's own order list. ddom gives every kit its
own supply order, which SupplyChain's explosion would never create, so the orders
are built by running the explosion in `make/do-explode-work-order.js` over the
sales order lines and the bills of material in this database:

* A kit or phantom (item type `K` or `P`) is spliced out of its parent's bill of
  material and replaced, in place and recursively, by its own components with
  `quantityPer` multiplied through — so no kit is ever a requirement or an order,
  and the kit's components sit in the parent's requirement list at the position the
  kit held.
* A requirement whose item has an inventory record and planning policy `M` is made
  to order: it gets a child work order, numbered on one flat counter across the
  group (`W-nnnnn-1` for the parent, `-2`, `-3` … for the rest), with a firm
  allocation from the child order to the parent requirement. An order that spawns
  no child keeps its plain number, as the routine does.
* A manufactured item whose policy is not `M` is replenished to stock rather than
  made to order, so it appears as a requirement with no child order.
  `2-GALLEY-ASSY` is the one such item here, and it gets its own weekly lot orders
  with no sales order link.
* Operations are scheduled forward from the order's start date, which is what the
  Timeline tab draws. Each operation's lead time is its run time (by run unit) plus
  setup, queue, wait and move, plus `(serviceLeadTime + 1)` days, and planned start
  and end chain operation to operation from UTC midnight of the start date. Start to
  due is the larger of the item's lead time and what the schedule needs;
  `operationEndDate` is where the schedule actually lands, which for a sub-assembly
  is usually well before its due date.
* Open demand is then allocated the way `plan/do-create-allocations.js` allocates
  it — inventory first, then open purchase order lines, skipping any item whose
  planning policy is `R`.

An item with no routing gets no operations, so its work orders have an empty
Timeline. That is the master data as it stands rather than a gap in the load:
`2-REAR-HATCH-ASSY` is the one such item here, and `demo`'s own `W-00018-5` has no
operations either.

The validation for this is that exploding `1-RR-RIALTO` reproduces the group
already in `demo` (`W-00018-1` … `-5`) order for order, requirement sequence for
requirement sequence, quantity for quantity — and, for the operations, lead time
for lead time, planned start and end timestamp for timestamp, and the same span in
days for every order in the group.

## The marker

`load.js` will only run a file whose first 60 lines contain

```
-- @featherbone-dev-script v1
```

That is what stops `--script` from being pointed at an arbitrary `.sql` file, or
at a `.js` file, by accident. A data script also declares `@target instance`,
and may declare `@requires-cleared` (it needs an empty database), `@rows` (how many
rows it loads) and `@anchor` (the date it treats as "today" unless `--anchor` says
otherwise); all three are shown in the prompt. Adding a new data script means
adding that header; without it the tool refuses and says why.

## Where the safety actually lives

In the scripts, not in `load.js`, so running a file by hand is no less safe:

* Both scripts read each database's `"$db"` marker and refuse anything that is
  not an `instance`. A database marked `mode=prod` needs an explicit extra flag.
* Both run inside one transaction, so a failure anywhere rolls the whole thing
  back.
* `clear-instance-data.sql` is a dry run unless told otherwise, and to execute
  it you must also name the database it is pointed at.
* `teardrop-campers.sql` refuses a database that still holds application rows,
  so it cannot quietly double-load, and it re-checks on the way out that
  inventory equals the sum of its transactions and that no transaction leaves a
  negative balance — rolling back if either fails.

## What `clear-instance-data.sql` decides to clear

It does not carry a list of tables. It reads `feather.module` and clears the
tables of every feather that belongs to an installed package rather than to
`Core`, so it covers whatever is deployed — SupplyChain, Job Shop, Finance, a
customer's own package — without being taught about it. A handful of Core
feathers that hold master data rather than configuration (`Contact`, `Address`,
`Comment`, `Kind`) are cleared too; that list is an option.

Two consequences worth knowing before the first run:

* Units of measure, item categories, item groups, terms, ship methods and the
  site record belong to packages (`Stock`, `Common`), not to `Core`, so they are
  cleared. `teardrop-campers.sql` recreates them. If you want them to survive a
  clear on their own, name them: `--keep Terms,ShipMethod,Site`.
* A table that holds rows but belongs to no installed feather stops the run
  rather than being silently left behind. `--clear-orphans` clears those too.

Core reference data that is *not* cleared — countries, states, honorifics,
currencies — is also what `teardrop-campers.sql` will not duplicate: it inserts
those rows only where they are missing, so clear-then-load and a load onto a
database that still has them both come out right.
