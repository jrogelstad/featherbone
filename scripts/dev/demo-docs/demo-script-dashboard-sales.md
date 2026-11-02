# Featherbone demo script: sections 1-3 (Dashboard, Sales, Purchasing)

Status: DRAFT 2 (Purchasing added 2 Nov). Walked click-by-click on the replica (Core alpha.27, SupplyChain 2.2.53, JobShop 2.3.10, clock 2027-06-01, seed v5), except where marked TO VERIFY.
Cast names are placeholders for John to confirm. Voice: Piper `ryan-high` (to confirm). Narration runs about 150 words a minute, so each section is about 5 minutes with pauses.

Conventions: **[click]** is an action on screen, *italic* lines are narration, (m:ss) is the target running time.

Starting state for the whole demo: the `demo` instance freshly loaded from `teardrop-campers.sql` (clock 2027-06-01), signed in as the section's user, dashboard refreshed once (Home, Refresh) so the figures are rebuilt.

---

## Section 1: Dashboard (about 5 min)

Cast: Dana Whitfield, Operations Manager (placeholder). Sign in as `administrator`-level user for now; later one-role user.

| Time | Action | Narration |
|---|---|---|
| 0:00 | Home tab, dashboard fully visible. Banner reads "As of June 1, 2027". | *This is Roadrunner Camper Company: teardrop campers, built to order in Arizona. Dana runs operations, and every morning she starts here, on the dashboard. Everything on it is live from the same database the shop floor and the sales desk use. Nothing is exported or re-keyed.* |
| 0:25 | Point at the strip under the title ("Figures rebuilt 8:11 AM, 3,933 sales daily totals ...") | *The figures are rebuilt from daily totals, so even with years of history the page comes up instantly. Dana can see exactly how current it is.* |
| 0:45 | **Sales metrics** tile. Hover Bookings YTD and On-Time Delivery. | *Sales first. Bookings year to date are six point seven million, profit one point six. Each bar is measured against a target, here the same period a year ago, and the orange tick marks where we should be. Bookings are ahead of the tick. On-time delivery is ninety-three percent, and it carries a red dot: it's behind last year. That's what Dana wants to dig into.* |
| 1:30 | **[click]** Sales Backlog ($2,539,100). Modal "Open sales order lines" (302 lines). Scroll to show first rows due 6/1/2027 in orange. Close. | *Every number that can be explained drills down. The backlog is two and a half million dollars across three hundred lines. The orange rows are due today. Dana sees specific orders and can open any of them from here.* |
| 2:15 | **Operations metrics** tile. Point at the red dots on Overdue Purchase Backlog and Produced MTD. | *Operations. Purchase backlog is about eight hundred thousand dollars. Of that, seventy-four thousand is overdue, flagged red. Produced month to date shows zero only because today is the first of the month; it resets overnight.* |
| 2:45 | **[click]** Overdue Purchase Backlog. Modal "Overdue purchase order lines", first row 4/30/2027 P-27001\1, $74,294. Close. | *The overdue list is oldest first. These are the parts that could hold up production, so she knows which supplier to call.* |
| 3:15 | **Sales, Production due by week** chart. Point at the "Today" line, the red past-due bars to its left, the tall bars after. | *This chart puts sales commitments and production side by side by week. Red bars left of the line are past due. Right of it the next three weeks are heavy: sales promised, production scheduled.* |
| 3:45 | TO VERIFY: **[click]** the first production past-due bar to open its drill. If it doesn't drill cleanly, skip and keep narration on the chart. | *Click a bar and you get the work behind it.* |
| 4:00 | **Top 10 revenue by customer** tile. Point at Lakeshore Campers, $775,500, 17%, 108 orders. | *Revenue by customer. Lakeshore Campers is a good customer, third on the list: a hundred and eight orders this year. Their buyer called this morning for another Rialto, so we'll use that order to follow work from the sales desk all the way to cash.* |
| 4:30 | Point at Revenue YTD by product: Rialto 22%. | *The Rialto is our luxury trim, about a fifth of revenue.* |
| 4:45 | End on the full dashboard. | *One order, one database, front door to the books. Let's take the order.* |

Notes for production:
- The region tile shows South, West and Midwest only (no Northeast). Don't dwell on it.
- Don't claim the on-time figures are "worse"; say "behind the target", which is what the dot means.
- Produced MTD $0 is a first-of-month artifact. If it reads awkwardly, John can move the faked clock to mid-month, which also changes the due-by-week chart; decide before filming.

---

## Section 2: Sales (about 5 min)

Cast: Marcus Reyes, Sales Representative (placeholder). Sign in as the sales role user. (Currently walked as admin.)

Result of the walk: new order **S-02141**, Lakeshore Campers, 1 x 1-RR-RIALTO, list $12,000 less 25% = **$9,000**, promise date **7/15/2027**.

| Time | Action | Narration |
|---|---|---|
| 0:00 | Delivery tab, **Sell** in the ribbon. Sales Order Backlog opens (187 orders, $2.55M). | *Marcus is on the sales desk. This is the open order list, a hundred and eighty-seven orders. Lakeshore calls: they want one more Rialto.* |
| 0:30 | **[click]** New. | *He starts a new order. The number is assigned when it saves.* |
| 0:45 | **[click]** the menu icon beside Customer, search "Lakeshore", select Lakeshore Campers, **Select**. | *Lakeshore is an existing customer, so their ship-to, terms and tax setup come straight in.* |
| 1:15 | **[click]** Add in Lines. In Product, open the search, pick 1-RR-RIALTO, **Select**. Description, site WH1, price $12,000 fill in. | *He adds the product. Price, unit and site fill in from the item. Lakeshore's twenty-five percent discount applies automatically.* |
| 1:50 | **[click]** the Ordered cell, type 1, Tab. Amount shows $9,000.00; subtotal updates. | *One camper. Nine thousand dollars.* |
| 2:10 | **[click]** Calculate Due Date. A planning window shows a Gantt: a new work order group, frame, body, cabin cabinet, rear hatch, the final assembly, then a shipping buffer. Due date 07/15/2027. | *Here's what customers ask first: when can I have it? Marcus doesn't guess. Featherbone plans the order against real capacity and open supply: frames and body first, cabin cabinet and hatch alongside, then final assembly, then a week for shipping. It's busy right now, so the earliest date is July fifteenth.* |
| 3:10 | **[click]** Use as Promise Date. Line promise date shows 07/15/2027. | *He takes that as the promise date.* |
| 3:25 | **[click]** Save. Returns to the list. Search S-02141, open it. | *Saved as S-02141. Still Incomplete: nothing has been committed.* |
| 3:50 | **[click]** Start. Status goes to Pending; the line shows Allocated 1. | *Start is the commitment. In one step Featherbone creates the work orders for the camper and each sub-assembly, plans the purchase orders for parts we're short on, and reserves the supply. Marcus didn't type a work order. Production will find them waiting.* |
| 4:20 | **[click]** Release. Status Active. | *Release tells the rest of the company the order is real: it goes on the pick list, and shipping can see it.* |
| 4:40 | End on the active order. | *Total time at the sales desk: a few minutes, with a date he can promise. Now production.* |

Notes for production:
- Do NOT click View Plan before saving. It navigates away to the Inventory Plan form and the unsaved order is lost. (The Inventory Plan shows the Rialto demand running -58 against supply, which is accurate but busy, so leave it for a later aside if at all.)
- The header Promise Date stays blank; only the line has one. Narrate the line.
- The Ordered cell must be clicked directly; the first cell the cursor lands in is Unit price.
- Start takes about 9 seconds on the replica. Cut or speed-ramp in the edit.
- "Start" tooltip is "Start production"; Release tooltip is "Change Pending order to Active".
- Placeholders to confirm: names, role titles, whether Marcus enters a PO number (left blank here).

---

## Section 3: Purchasing (about 5 min)

Cast: Priya Nair, Buyer (placeholder). Sign in as the buyer role user (walked as admin).

Starting state: S-02141 is Active (end of Sales). Start created three planned purchases, all linked to the order: PL-1 4 x 3-EVO-FEET-MOUNT at $40, PL-2 2 x 3-ROOF-SPAR at $125 (both eTrailer dot com, due 6/28/2027), and PL-3 the powder coat (Tidewater, $100). Result of the walk: one PO **P-27034** for eTrailer, $410, plus a second PO **P-27035** for Home Depot, $125.86.

| Time | Action | Narration |
|---|---|---|
| 0:00 | Plan tab, **Buy** in the ribbon, **Planned Purchases** sheet. Three rows: PL-3, PL-1, PL-2. Scroll right to show Price, Primary Demand (W-01834-1.55 / .56), Sales Order S-02141, Lakeshore Campers, 1-RR-RIALTO. | *Priya is the buyer. When Marcus started the order, Featherbone worked out what the Rialto needs that we don't have on the shelf and planned the purchases. Nobody typed these. Each line says what it's for: the roof rack mounts and the roof spar, for work order one on sales order S-02141, Lakeshore's Rialto.* |
| 0:50 | Point at supplier ETRAILER and price columns. | *It also picked the supplier and the price, from the item's supplier list: eTrailer for both, forty dollars a mount, a hundred and twenty-five a spar.* |
| 1:15 | **[click]** PL-1, **[shift-click]** PL-2. Ribbon **Convert** lights up. | *Both are from the same supplier, so she'll buy them together. The powder coat is a different animal: it goes out to Tidewater and comes back, so it is handled with outside processing. She leaves it.* |
| 1:40 | **[click]** Convert. Dialog "Convert planned purchase": Supplier ETRAILER, Use Existing Order unchecked. **[click]** Convert. | *Convert turns plans into a purchase order. She could add to an open order with this supplier; today a new one.* |
| 2:00 | Purchase Order P-27034 opens, status Pending: eTrailer dot com, contact, planned delivery 06/28/2027, two lines, total $410.00. | *One order, two lines, four hundred and ten dollars, with the supplier's contact already on it and the planned delivery date carried from the plan.* |
| 2:25 | **[click]** Release. Status Active. (The PO PDF opens in a new tab; cut to it for a moment.) **[click]** Print: "Success". | *Release makes the order real and produces the document for the supplier. Print sends it to the printer. Email is one more button.* |
| 2:55 | Plan tab, **Plan** workbook, **Shortages** sheet. Point at the rows with negative Projected. | *The buyer's second job: what else is short? This list is everything projected to run out against demand. The campers are made to order, so they show here by design. The purchased items are the ones Priya cares about.* |
| 3:25 | **[click]** 3-HOSE-CLAMP-1 (projected -12). **[click]** Create Planned Order. A Planned Purchase form opens: quantity 70, Home Depot, supplier item 602046, **Order Quantity 7 pack at $17.98**, Ratio 10. | *Hose clamps are short by a dozen. She raises a planned purchase right from the shortage. Featherbone fills in the supplier, their part number, and the price, and it converts the units: we use clamps one at a time, Home Depot sells packs of ten, so it orders seven packs for seventy clamps.* |
| 4:00 | **[click]** Save. Buy, Planned Purchases, **[click]** the new row (PL-5), **Convert**, **Convert**. PO P-27035 opens: Home Depot, 7 packs, $125.86. **[click]** Release. | *Convert, release. Two purchase orders in a couple of minutes, and every line traces to a reason.* |
| 4:20 | **[click]** Open Purchase Orders, search P-27034, open it. **[click]** Receive. Purchase Order Receipt: both lines, To Receive 4 and 2. **[click]** Receive All, **[click]** Save. Status Received. | *Parts arrive from eTrailer. The dock person opens the order, receives everything against it, and saves. The roof rack parts are on the shelf, and the order's lines show received.* |
| 4:50 | End on the receipt (or the two lines now received). | *With parts in, the production manager has what he needs. Next, production.* |

Notes for production:
- Verified on the replica: select two rows with the same supplier and Convert makes ONE PO with both lines. Saving the receipt posts it (status Received, stock 4 and 2); no separate Post step.
- The visible rows past the screen width (Price, Primary Demand, Sales Order) need a horizontal scroll; or shrink columns in the cut.
- Cut the delivery gap between release and receipt (parts are planned for 6/28; the film receives them on 6/1). Say "when the shipment arrives" and cut.
- Do not convert or receive PL-3 (powder coat): it is an outside process and cannot be received as an ordinary PO receipt. Leave it in Planned Purchases.
- The new receipt shows as RC-07740 (receipts share one number sequence with work order receipts). Correct, but avoid dwelling on it.
- Send (email) is not demonstrable (no mail service); skip.
- Release opens the PO PDF in a new tab (`buySettings.onRelease`); headless recording gets a download, so render the PDF to an image and cut it in.
- Placeholders to confirm: Priya Nair as buyer; whether to show the Shortages beat or end at the first PO (about 1:45 shorter).

---

## Open items before filming

1. Confirm cast names, voice (`ryan-high`), and whether Produced MTD $0 is acceptable (or move the clock).
2. Verify the production past-due bar drill; confirm the sales-role user can see Start and Release.
3. One-role users and Employee records (cast script) not built yet; walked as admin.
4. Reload the v5 seed on John's real `demo` to confirm the CAD, logo, shop floor and dashboard fixes there.
