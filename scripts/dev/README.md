# scripts/dev

Developer tools that change data. Nothing here is installed, deployed or run by
the framework: no manifest lists these files, the installer never sees them, and
the server never reads them. They exist to be run by hand, by a developer, on a
database they are willing to lose.

| File | What it does |
| --- | --- |
| `clear-instance-data.sql` | Empties the application master-data and transaction tables of one instance, leaving the Featherbone control tables (`$workbook`, `$settings`, `$feather`, forms, routes, scripts, roles, users) intact, so the packages still work. |
| `load.js` | Runs a data script against one instance, optionally clearing it first. Warns, asks, and refuses to run a file that is not marked as a data script. |
| `help-shots.js` | Retakes the help's screenshots from a running server, as each help folder's `shots.json` says. Besides the screen it can draw callouts on a picture, drag, type and take a printed form (a PDF) as a picture, and a shot names the `setup` of the demo data it needs. Changes no data except the signed-in user's own workbook layouts, which shots that set a filter or sort revert afterwards: run it as a user whose layouts you don't mind losing. Needs Playwright, which is not a dependency (`npm install --no-save playwright && npx playwright install chromium`), and poppler's `pdftoppm` for the printed forms. |
| `help-shots-stage.js` | Puts the demo in the state those pictures need: the Enterprise edition, work orders released and completed, a taxed, a part-paid and a prepaid invoice, a location controlled site. It posts shipments, invoices and payments, so run it on a throwaway copy of the demo, never one that is kept. |
| `demo-data/teardrop-campers.sql` | Seventeen months of Road Runner Campers trading history plus the forward order book, built out from the ddom "Teardrop Campers" demo dataset. 271,054 rows, 17 complete months, as-of 2027-06-01. |
| `demo-data/demo-settings.sql` | Runs by itself after every data script (`--no-settings` skips it). Reads each setting's definition and points every relation (default site, print forms) at a record that exists: refreshes its copy of the name, repoints a missing one by feather and name, code or name, else the only record; fills in a missing default site; says what it could not fix. Safe to repeat. |

## Retaking the help's pictures

Restore a fresh copy of the demo (Standard edition), then stage a setup and take
its pictures, in this order. The pictures with no `setup` come first, from the
Standard demo with the records the `standard` setup adds:

```
node scripts/dev/help-shots-stage.js standard
node scripts/dev/help-shots.js                       # Core
node scripts/dev/help-shots.js --package ../supplychain
node scripts/dev/help-shots-stage.js enterprise
node scripts/dev/help-shots.js --package ../supplychain --setup enterprise
node scripts/dev/help-shots-stage.js billing
node scripts/dev/help-shots.js --package ../supplychain --setup billing
node scripts/dev/help-shots-stage.js locations
node scripts/dev/help-shots.js --package ../supplychain --setup locations
```

Name a picture after the options to retake only the ones whose file names contain
it. The printed forms print the company logo from `files/upload`, so the instance
needs the demo's logo there.

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

## Dates, and the five months that are not ddom's

The as-of date is **2027-06-01**, with **17 complete months** of trading behind it
(2026-01 .. 2027-05) and a forward order book running to 2027-10. That gives a
dashboard a whole prior calendar year to compare against plus five months of the
current one.

ddom's own demand covers 2026-02 .. 2027-01 and sits here unshifted, which is what
keeps the seasons right: this is a camper maker, and demand peaks in June and
bottoms out from November to January. Five months are not ddom's and had to be
built:

| Month | Why |
| --- | --- |
| 2026-01 | ddom has no January at all |
| 2027-01 | ddom's data runs out on the 29th, so its January is a part month; topped up to the level the surrounding winter months show |
| 2027-02 .. 2027-05 | past the end of ddom's history |

Each is modelled on the same calendar month a year earlier — its orders resampled
in their own day-of-month pattern, same products, same quantities — at about **8%**
above it, so the seasonal curve holds and year-on-year reads as steady growth
rather than noise. The resampling is seeded, so the same file always produces the
same months. The forward order book thins with distance, from about 85% of a month
booked in 2027-06 down to 12% in 2027-10, the way an order book actually fills.

What comes out, by ship month:

```
2026   J   F   M   A   M   J   J   A   S   O   N   D
units  51 110 111 150 127 159 136  88 123 114  55  53
2027   J   F   M   A   M  | open book: Jun 137 lines, Jul 80,
units  62 113 133 155 139 |            Aug 42, Sep 30, Oct 13
YoY  +22  +3 +20  +3  +9  |
```

Late shipments (below) slide a few units across month ends, which is why the
year-on-year is less even than the 8% the months were built at.

### On-time delivery

Not everything is on time. Each document keeps its promised date and the actual
lands later on some of them. A month's late share rises with that month's sales
volume, and the shares are set so the first five months of 2027 come to:

| | On time, 2027-01 .. 2027-05 | Same months, 2026 | Rule |
| --- | --- | --- | --- |
| Shipments | 93.0% | 93.5% | `ship_date <= sales_order.promise_date` |
| Work orders | 92.0% | 92.2% | `receipt_date <= work_order.due_date` |
| Purchase receipts | 84.9% | 87.0% | `receipt_date <= purchase_order.planned_delivery` |

* **Shipments** are one to about eight business days late; 64 of 955 are.
* **Work orders follow the shipments.** Behind every late shipment one order in the
  group (the top or a component) finishes late, and every order above it slips by the
  same days. A few more are late but caught up in slack and the shipment still goes:
  those are one day late, or up to three for the replenished 2-GALLEY-ASSY.
* **Purchase receipts** are late independently, but never past the day the stock is
  first needed, so a late receipt never starves a work order.
* The quietest months (November to January) have too few orders to be late at the
  rate; some of them are 100%.

The late months are chosen by quota with a fixed seed, so the same file always
produces the same figures. Nothing is late past the as-of date.

### Moving it

The dates above are what the file carries. To move the whole data set without
regenerating it, set an anchor; every date and timestamp shifts together —
history, open book, operation schedules, inventory:

```
npm run dev:load -- --anchor 2028-06-01 --script scripts/dev/demo-data/teardrop-campers.sql --db demo
PGOPTIONS="-c featherbone.load_anchor=2028-06-01" psql -d demo -f scripts/dev/demo-data/teardrop-campers.sql
```

**Shift by whole years** to keep the seasons where they are — a shift of five
months, say, would move the June peak to November. A shift that is not a whole
number of weeks also moves the weekly batching off its weekday, and says so when
it loads. The load always reports the anchor it used.

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

* Units of measure, item categories, item groups, terms, ship methods, the
  site record and the sales regions (`SalesRegion`, `SalesRegionState`) belong to
  packages (`Stock`, `Common`, `Sell`), not to `Core`, so they are cleared.
  `teardrop-campers.sql` recreates them. If you want them to survive a clear on
  their own, name them: `--keep Terms,ShipMethod,Site,SalesRegion,SalesRegionState`.
  Regions are the four US census regions over all fifty states and DC; if a
  database has the demo data but lost them, `sales-regions.sql` puts them back.
* Settings are not cleared, but the rows the load creates get new ids every time, so a
  setting that names one goes stale: Design settings' default site did, and New Product then
  failed to save with `Relation not found in "Site"`. `load.js` therefore finishes every data
  script by running `demo-settings.sql`, which points each setting at a record that exists.
* A table that holds rows but belongs to no installed feather stops the run
  rather than being silently left behind. `--clear-orphans` clears those too.

Core reference data that is *not* cleared — countries, states, honorifics,
currencies — is also what `teardrop-campers.sql` will not duplicate: it inserts
those rows only where they are missing, so clear-then-load and a load onto a
database that still has them both come out right.

## Screenshots for the help

```
node scripts/dev/help-shots.js --base http://localhost:3003/demo --user jtaylor --password secret
node scripts/dev/help-shots.js --package ~/Documents/SupplyChain sales-order   # a package's, by name
node scripts/dev/help-shots.js --dry-run                                     # what would be taken
```

Each picture is named for the help, not the screen, so retaking one
overwrites the same file and no page changes. Pictures a `shots.json` cannot
take yet are listed under its `notTaken`, with the reason.
