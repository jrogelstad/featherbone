# Purchase orders

## Purchase order actions

- **Release** — Changes the purchase order to Active status so receipts can be done against it. buy settings can be configured so that when a purchase order is released a PDF form is automatically printed, sent, downloaded, or opened.
- **Unrelease** — This changes the purchase order from Active back to Pending status and thus disallowing receipts.
- **Close** — The forces the purchase order to change to Closed status. Once it is closed, you can no longer do receipts.
- **Print** — This will print a PDF version of the printed purchase order form set in buy settings. After printing you will be prompted whether the print succeeded. If you confirm yes the Is Printed, Printed Time and Printed By dates will be updated on the purchase order.
- **Send** — This will send a PDF version of the printed purchase order form set in buy settings to the primary contact on the purchase order. You have an opportunity to change the recipients, subject and edit the message body. The message body by default is populated with the default text specified in buy settings. After sending the Is Printed, Print Time and Printed By dates will be updated on the purchase order the same as if it had been printed. Send is only enabled if email settings have been configured in global settings.
- **Ship** — If the purchase order has service items on one or more of its lines, you can record shipments of goods sent to the supplier for processing. This action will launch the outside process shipment form directly from the purchase order automatically populated with the order’s information.
- **Receive** — This action will launch the purchase receipt form automatically populated with the order’s information.

## Purchase Order Header

- **Number** — A unique order identifier auto generated on save. All purchase orders start with “P-“.
- **Supplier** — The supplier you are purchasing from. When the supplier is selected the primary contact, terms, ship method, and Inco terms set on the supplier will copy into the purchase order.
- **Site** — The site where the purchase should be delivered. When a site is selected, the ship to and bill to addresses will be copied from the site to the purchase order header.
- **Contact** — The primary contact for the purchase order.
- **Status** — See the article on the purchase order lifecycle for details about purchase order status.
- **Order Date** — The date the order was or is intended to be placed. Planning Gantt charts will use this as the start date in lead time visualizations.
- **Planned Delivery** — The delivery date initially requested. If no confirmed date is set, this is the due date of the line items.
- **Confirmed Delivery** — The delivery date confirmed by the supplier. When this is set or changed all the lines are populated with the new confirmed delivery. When set, the confirmed delivery supersedes the planned delivery as the current due date for line items.
- **Reference** — Free form text to reference supplier feedback information, typically their sales order number.
- **Subtotal** — The sum of all line-item amounts.
- **Tax** — A manually set tax amount.
- **Freight** — A manually set freight amount.
- **Total** — The sum of subtotal, tax and freight.

## Purchase order lines

- **View Plan** — This action will open the inventory plan form for the selected item so you can analysis all shop activity for the item.

- **Line #** — An auto generated sequential number. Moving rows up and down will resequencing the lines.
- **Status indicator** — See purchase order life cycle for more details about purchase status.
- **Item & description** — Select an active product to purchase. Purchases for services can only be set by planned orders created by service operations on work orders.
- **Ordered** — The quantity to purchase is the supplier’s unit of measure.
- **Unit** — The supplier’s unit of measure. Either a global or product-based unit of measure conversion must exist from the supplier’s unit to your stocking unit for this row to be valid.
- **Price** — The supplier’s price. If there is a supplier item and price record for the order quantity, then the price will be automatically populated.
- **Amount** — The order quantity multiplied by the price.
- **Received & Unit** — Information about how much has been received in the stocking unit of measure.
- **Remaining** — How much remains to be received in the stocking unit of measure.
- **Confirmed Delivery** — The date the supplier has confirmed the item will be delivered. A change to the header confirmed delivery will update this date, however, it can be changed to be different from the header if the lines aren’t all expected to be delivered at the same time. If populated, this date becomes the due date for the supply in inventory plan and timeline calculations.
- **Allocated** — The quantity of the supply allocated to specific demands.

Additional attributes are visible when opening up the line-item detail form:

- **Changed Delivery** — Use this date if the supplier changes their delivery date, but you want to preserve the original confirmed delivery for historical tracking. The changed delivery will become the new due date for the supply.

- **Back ordered** — The quantity back ordered in the stocking unit of measure. Back ordered quantity calculates as the remaining due if the line is partially received.

Components copy from the bill of materials when the line item is for a product that is a kit. In this case the components are supply records for inventory planning. All the attributes on components work the same as their line-item counterparts.

All the audit fields on the line item work the same as their header counterparts.

## Purchase order notes

Notes are unlimited text you can keep on the order.

- **Ship Instructions** — These notes print on the default purchase order template.
- **Comments** — These notes are for internal use and do not print.

## Purchase order shipping

- **Ship to** — The ship to copies from the site record and instructs the supplier where to deliver the items.
- **Ship method** — The ship method copies from the supplier record and instructs the supplier how to ship the items.
- **Incoterms** — The Incoterms copy from the supplier and define the responsibilities of exporters and importers in the arrangement of shipments and the transfer of liability involved at various stages of the transaction.

## Purchase order billing

- **Bill to** — Instructs the supplier where to send invoices and statements. Copies from the site bill to address.
- **Currency** — The currency of the Purchase Order. Defaults to US Dollar.
- **Payment terms** — The agreed finance terms with the supplier on this order. Copies from the selected supplier.

## Purchase order documents

Here you can link the order to multiple supporting documents such as PDFs or images. The documents must be accessible from a web address from such as a One Drive, Google Drive or Drop Box link.

## Purchase order audit

- **Created** — The time the order was created.
- **Created By** — The user account who created the order.
- **Updated** — The last time the order was updated.
- **Updated By** — The user account who last updated the order.
- **Buyer** — The employee that is responsible for the order. If the currently logged in user account is associated with an employee flagged with “Is Buyer” equals true, then the buyer will default to their employee account. Otherwise, the list of potential employees that can be assigned is filtered on all employees where “Is Buyer” equals true.
- **Is Printed** — Flagged true when the order has been successfully printed or downloaded.
- **Print Time** — The time the order was successfully printed or downloaded.
- **Printed By** — The user account who successfully printed or downloaded the purchase order document.

## How the purchase order life cycle works

Purchase orders are used to keep track of products or services you are buying from a supplier including but not limited to quantities, pricing, billing terms, delivery date and delivery information, so you know what is coming and when. Active purchase orders are shown by default in the Purchase Orders worksheet in the Buy workbook. You can create purchase orders manually from this worksheet, or automatically by converting one or more planned purchase orders to a purchase order. Job Shop will help you populate a new purchase order quickly by copying supplier and product information into the order when applicable. You can print a purchase order form to send to the supplier. You record the delivery of inbound materials with a purchase receipt.

Note: your workflow patterns may differ. See alternate workflows for more information.

Purchase orders can be in one of the five states shown below, where they generally flow from pending to closed, though some statuses are optional depending on the business process.

The statuses work as follows:

- **Pending** — This is the initial state of the purchase order before having been confirmed by the supplier.
- **Active** — Purchase orders in this state have been released and are presumably confirmed by the supplier.
- **Receiving** — Purchase orders automatically change to a “Receiving” state when a receipt is created for the order. This status is mostly informational but also prevents changing quantities while the order is in this status.
- **Back Order** — This is a status that purchase order will go into after a receipt is posted if the quantities of items were not received complete. The purpose of backorder is to make it easy to identify active purchase orders that have at least been received partially.
- **Closed** — The order changes to closed when all quantities have received complete, or if it is manually closed. At this point the purchase order is read only for historical purposes and no further receipts may be made on it.

The Buy module supports tracking purchase orders for an outside process on Pro and Enterprise editions. When you create a work order with operations that have a service set on them, Job Shop automatically creates a planned purchase for the outside process service. You can convert this planned purchase to a purchase order the same way as planned purchases for products. You can also keep track of what quantities you have sent out for outside processing by creating an outside process shipment against the purchase order. When shipped, Job Shop will report an operation completion on the work order related to the shipment that the operation has started. When the work is shipped back to your shop, your record a purchase receipt like any other purchase order. The difference is that instead of receiving goods in inventory, an outside process records a work order operation completion related to the operation that the purchase order is linked to.

The order cycle diagram below shows the role purchasing an outside process can play in the scheme of your order cycle.

Just because you can track all the details of an outside process doesn’t mean Job Shop forces you to. Here are some transactional details you have the option of skipping.

- **Don’t record the shipment** — You create the outside process purchase order, but you don’t bother to record the shipment, only the receipt. Job Shop will let you do this and assume the shipment must have happened. However, be aware that if you do record any outside process shipments, then you will not be allowed to receive a quantity greater than what you shipped.
- **Don’t record the shipment or receipt** — If downstream operations from the operation with the service are reported complete, or a work order receipt is recorded, Job Shop will assume the outside process must have happened and update operation completion quantities with the assumed completions. However, do note if some purchase receipts have been recorded and shop floor users attempt to report an operation completion greater than what was received, the operation completion posting will fail.
- **Don’t create the purchase order** — You may not even want to bother creating a purchase order at all but only include a service on the operation to support cost calculations. Again, if downstream operations record completions, then the operation with the service will be automatically completed even without a purchase order.

> See also[Purchase order](#purchase-order-header)Outside process shipment

## Open Purchase Orders

By default this lists all active purchase orders sorted from oldest to newest. All purchase order actions can be performed from selections on this list.

> See also[How the purchase order life cycle works](#how-the-purchase-order-life-cycle-works)[Purchase order](#purchase-order-header)

## Closed Purchase Orders

This is a historical list of closed purchase orders that can be viewed for investigation and auditing purposes. Closed purchase orders are read only, so no action can be taken on them.

## Planned purchases

Planned purchases are created automatically when the create planned order action is run from the shortages and reorder tabs in the Plan workbook, and for sales order lines and work order materials when they are released for inventory products that are set to plan-to-order, or when the Plan Supply action is run from these demand orders. See the planning concepts overview for more information about planning logic.

- **View Plan** — This will open the inventory detail form with supporting details as shown below.
- **Convert** — Convert the selected planned purchase or multiple selected planned purchases to a purchase order. This will copy all the supplier information from the planned order to a purchase order. The supplier of the first selected planned order will be the default supplier on the convert purchase order dialog. You also choose to append the planned orders to an existing purchase order.

When you click Convert, the newly created or edited purchase order will open.

The planned purchase detail form includes the attributes shown below. You have an opportunity to change or amend any of the editable information on the planned order before converting to a purchase order.

All of the attributes shown above the supplier tab relate to the demand that created the planned purchase, and order quantity rules set the product or service’s site record. All of the supplier attributes are brought in from product supplier information based on the preferred supplier. Price break information is selected according to the order quantity and price break rules on the the item’s supplier record if applicable. The ratio between the order quantity in the supplier’s unit of measure and your stocking unit of measure is determined either from the global conversions, product conversions or services conversions table, whichever is applicable.

## Purchase receipts

Purchase receipts allow you to record the receipt of specific products or services from a supplier against a purchase order. When posted it decrements the quantity outstanding due on the purchase order. When all quantities are received, the purchase order closes. In the case of inventory a receipt posting increments the quantity on hand and allocations against the purchase order lines are changed to inventory allocations. For services it increments how much quantity on an associated work order operation have been completed.

- **Post** — This function records the transactions associated with a receipt as described above. Posting happens automatically when a receipt is saved. However, if the posting should fail you can use this action to reattempt the transaction. For example, a receipt may fail to post if you have an active physical inventory count underway. In a case like this, you will have to post the receipt after the count is complete. You should also make sure in this case not to include the supply received from that purchase order in your count.

- **Number** — An automatically generated unique identifier. For receipts this number starts with “RC-“.
- **Purchase Order** — Select a purchase order to receive. Only active purchase orders may be selected.
- **Status** — Defaults to Pending. Once posted the receipt status is Received.
- **Site** — The site copies from the purchase order.
- **Lines** — The lines automatically copy in from the purchase order when a purchase order is selected. Most attributes are informational, except the received quantity which you enter to indicate the quantities received. Use the Receive All action to automatically populate the received quantities with all outstanding quantities due.
