# Job Shop help file

Generated 2026-10-08 from the Job Shop knowledge base at featherbone.com,
reorganised under the JobShop 2.3.0 navigation categories.

## What's here

| File | Goes to | Notes |
|---|---|---|
| `job-shop-help.html` | `featherbone/public/help/` | Self-contained, 320 KB, no external assets |
| `module/helpLinks.json` | JobShop package root | **New** — 82 `HelpLink` records |
| `module/workbooks.json` | JobShop package root | **Changed** — every worksheet's `helpLink` wired |
| `module/manifest.json` | JobShop package root | **Changed** — registers `helpLinks.json` |
| `JobShop-v2.3.0-with-help.zip` | — | The original package plus the three files above, ready to install. Version deliberately left at 2.3.0 |
| `knowledgebase-articles.zip` | — | The 181 scraped articles as JSON, so nothing needs re-fetching |

## Deployment

1. Copy `job-shop-help.html` to `featherbone/public/help/job-shop-help.html`.
   `server.js` already does `app.use(express.static("public"))`, so it is served
   at `/help/job-shop-help.html` — mounted on `app`, not `dbRouter`, so the URL
   is database-independent.
2. Install the module package.

The help file **cannot** travel inside the module zip: `installer.js` accepts only
`install`, `execute`, `module`, `service`, `feather`, `batch`, `workbook` and
`settings`, and anything else hits `rollback("Unknown type.")`. It has to be
deployed as a static file.

### If you host it elsewhere

Every `resource` is `/help/job-shop-help.html#<anchor>`. To point at
featherbone.com instead, change `HELP_BASE` in the generator and re-run — the
anchors stay the same.

## How it is wired

`sheet.helpLink` is `relation(HelpLink) [label,icon,resource,displayValue]`, and
`workbook-page.js` does `window.open(link.resource)` on the help button, falling
back to a disabled button titled "No help page assigned to this worksheet" when
`resource` is empty. So each worksheet's `helpLink` carries the denormalised
record and deep-links straight to its topic.

`helpLinks.json` is registered **before** `forms.json` in the manifest so the
`HelpLink` rows exist before `workbooks.json` is processed. This matches the
order `packager.js` itself emits (`addBatch("HelpLink", …)` runs ahead of
`addForms`), so a repackage from the UI will keep it.

Record ids and etags are derived deterministically from the module name and
topic slug, so regenerating produces identical ids rather than orphaning rows.

## Coverage

- **197 topics** — 181 from the knowledge base, 16 synthetic for worksheets with
  no article (Develop, Count, Project, Contacts, Processes).
- **159 documented, 38 stubs.**
- **82 of 82 worksheets** wired, each to a distinct topic.

No worksheet in JobShop 2.3.0 had an existing help link — all 82 had either no
`helpLink` key or one with an empty `resource` — so the "existing help wins" rule
preserved nothing. The generator still enforces it: any worksheet with a
non-empty `resource` is left untouched on re-runs.

### Articles that are unwritten on the site (22)

These render as "Not yet documented" stubs with a link to the live article:

- **All six reports** — inventory value, WIP value, prepaid revenue, sales
  revenue, tax revenue, cost of goods sold
- **Fourteen of sixteen Setup articles** — user accounts, employees, states,
  countries, carriers, ship methods, tax types, sites, locations, print forms,
  labor resources, machine resources, Ship Engine, alerts. Only the two
  authorization tables have content.
- `count-settings`, `how-to-use-taxes`

That means the **Report** workbook (6 worksheets) and the **Settings** workbook
(12 worksheets) currently open to stubs. Writing those 22 articles is the single
highest-value follow-up.

## Source content worth fixing

Transcribed verbatim — typos preserved, nothing silently corrected.

**Wrong entity (copy/paste):**
- `work-order-actions` → Unrelease says "changes the **sales order** from Active
  back to Pending"
- `invoice-actions` → Open says it opens "the printed **sales order
  confirmation** form"
- `sales-order-actions` → Send Confirmation sends to the contact "on the
  **purchase order**"
- `sales-order-shipment-actions` → Ship says "in the case of an **outside
  process shipment**"
- `how-the-shipping-cycle-works` → a figure is captioned "Purchase order statuses"
- `sales-order-audit` → Picklist Is Printed says "when the order
  **confirmation** has been printed"
- `design-settings` → "Default purchase planning policy" is described as the
  policy for **manufactured** products

**Miscounts:**
- `product-general-attributes` — "four types" but lists three
- `how-the-work-order-life-cycle-works` — "six states" but documents five
- `how-the-sales-order-life-cycle-works` — "seven states", but On hold is
  separate, so six

**Inconsistent names for one field/state:**
- Print Time / Printed Time / Confirmation Print Time
- Back Order / back ordered / Backlog
- Pro and Enterprise / Job Shop Plus and Enterprise

**Broken links:**
- `demand-signal-definition` — the "Dependent Demand" See-also points at itself
- `work-order-timeline` — See-also "Work order schedule type" has no such article
- `conversions` and `design-settings` use bare "here" / "Click here" link text,
  which carries nothing offline

**Content gap:** `planned-work-orders` promises "the attributes shown below" and
then publishes no attribute list.

## Regenerating

```
build/gen.py          # reads articles/ + jobshop/, writes out/
build/structure.py    # section order, worksheet -> topic map
build/catalog.py      # the 181 slugs and their authored titles
```

Titles come from the site's own sidebar, not the article `<h1>` — the `<h1>`
carries `text-transform: capitalize`, which yields "Adding And Removing
Worksheets" rather than the authored sentence case.
