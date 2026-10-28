# Sales orders

## Sales order actions

- **Start** — Changes the sales order to Pending status causing line items to become active demands. All products that require allocated supply are automatically planned.
- **Release** — Changes the sales order to Active status so shipments can be done against it. sell settings can be configured so that when a sales order is released a PDF form is automatically printed, sent, downloaded, or opened.
- **Unrelease** — This changes the sales order from Active back to Pending status and thus disallowing shipments.
- **Close** — The forces the sales order to change to Closed status. Once it is closed, you can no longer ship against it.
- **Plan supply** — This will cause the automatic planning process to run. This is a good option if the sales order’s previous supply plan has been invalidated due to cancelled supply orders, other orders taking the previously allocated supply or some other unexpected situation.
- **Put order on hold** — This changes the sales order On Hold status to true. When it is in this state you can not ship against it. You will also be prompted whether child work orders should be put on hold so transactions against them will be frozen.
- **Take order off hold** — This changes the sales order On Hold status to false so you can ship against it. You will also be prompted whether child work orders should be taken off hold so transactions against them can resume as well.
- **Send Confirmation** — This will send a PDF version of the printed sales order confirmation form set in sell settings to the primary contact on the purchase order. You have an opportunity to change the recipients, subject and edit the message body. The message body by default is populated with the default text specified in sell settings. After sending the Is Printed, Print Time and Printed By dates will be updated on the sales order the same as if it had been printed.

Send is only enabled if email settings have been configured in global settings. - **Print Confirmation** — This will print a PDF version of the printed sales order confirmation form set in sell settings. After printing you will be prompted whether the print succeeded. If you confirm yes the Is Printed, Printed Time and Printed By dates will be updated on the sales order. - **Open Confirmation** — This will open a PDF version of the printed sales order confirmation form in a new tab. Print statuses will be updated on the order after opening. - **Download Confirmation** — This will download a PDF version of the printed sales order confirmation to your downloads folder. Print statuses will be updated on the order after downloading. - **Prepaid Invoice** — This will launch the prepaid invoice form automatically populated with sales order’s information. - **Ship** — This action will launch the sales order shipment form directly from the sales order automatically populated with the order’s information.

## Sales order header

- **Number** — A unique order identifier auto generated on save. All sales orders start with “S-“.
- **Customer** — The customer you are selling to. When the customer is selected the site, primary contact, terms, ship method, and incoterms set on the customer will copy into the sales order.
- **Purchase Order** — The customer’s purchase order reference number.
- **Order Date** — The date the order was received. Planning Gantt charts will use this as the start date in lead time visualizations.
- **Status** — See the article on the sales order lifecycle for details about sales order status.
- **Site** — The site where the sales order will ship from. When a site is selected, the ship to and bill to addresses will be copied from the site to the sales order header.
- **Requested Date** — The delivery date initially requested. If no promise date is set, this is the due date of the line items.
- **Promised date** — The ship date confirmed by you. When this is set or changed all the lines are populated with the new promise date. When set, the promise date supersedes the planned delivery as the current due date for line items.
- **Subtotal** — The sum of all line-item amounts.
- **Shipping** — A manually estimated shipping charge.
- **Tax** — The sum of all tax rows.
- **Total** — The sum of subtotal, shipping and tax.

## Sales order lines

*A sales order with one line item*

Use this action to estimate when a product can be shipped based on material availability and lead times. By default, it will show the work orders required to complete the delivery, and a standard shipping time buffer to help you calculate a reliable lead time. Double clicking on any of the time bars will either take you to the product detail if there is no active order yet, or order detail if the bar relates to an existing order.

*Calculate due date Gantt chart.*

If you check “Show detail” you will also see plan-to-order products and service dependencies on the order as shown below.

Note to reduce the clutter of the Gantt chart, materials that inventory on hand allocated and reorder point planned inventory are not shown.

When you click “Use as Promise Date” the suggested Due Date will automatically apply as the promise date for the selected line.

This action will open the inventory plan form for the selected line so you can analyze all warehouse activity for the product.

- **Line #** — An auto generated sequential number. Moving rows up and down will resequencing the lines.
- **Status indicator** — See sales order life cycle for more details about sales order status.
- **Product & description** — Select from products that are active and marked “Is Sold.”
- **Ordered** — The quantity you will deliver.
- **Unit** — The product’s unit of measure.
- **Price** — The price per unit. If there is a price set on the product, it will be copied in.
- **Discount** — The discount percentage applied to the price copied from the customer record.
- **Amount** — The order quantity multiplied by the price and subtracting the line discount.
- **Taxable** — Checked by default if both the customer and the product records are flagged as taxable. If true, this row is included in tax calculations in the tax tab.
- **Promised Date** — The date the you have confirmed the product will be delivered. A change to the header confirmed delivery will update this date, however, it can be changed to be different from the header if the lines aren’t all expected to be shipped at the same time. If populated, this date becomes the due date for the supply in inventory plan and timeline calculations.
- **Priority** — An indicator of the level of urgency of the line item. When changed, the priority copies down to any active work orders allocated to the sales order including child work orders.
- **Allocated** — The quantity ordered with allocated supply.
- **Shipped** — The quantity already shipped.
- **Back Ordered** — The quantity remaining to ship if a shipment of the line has been made. Only calculates if shipment settings are flagged to use back orders.
- **In Shipping** — If a shipment is active that has not yet been shipped, this is the quantity on the shipment.

Additional attributes are visible when opening up the line-item detail form:

*Sales order line detail form*

- **Discount Price** — The unit price with the discount applied.
- **Original Promise** — When you initially set a promise date, the original promise date is also populated with this date. Later if you change the promise date, the original is left unchanged as a record of the original commitment for historical tracking.

The timeline shows Gantt chart timelines and material dependencies for supply allocated to satisfy the selected line. Click on a Gantt chart node to drill into detail about the supply.

Note to reduce visual clutter, supplies for which there are on hand inventory allocations are not shown.

- **Ship instructions:** — These print on the shipment pick list.
- **Notes** — Notes are for internal use only.

Kit materials copy from the bill of materials when the line item is for a product that is a kit. In this case the materials are supply records for inventory planning. All the attributes on components work the same as their line-item counterparts.

The costs tab shows the cost of goods sold shipped on the order based on the standard costs set on the product record.

All the audit fields on the line item work the same as their header counterparts.

Information about who created and last updated the line and when.

## Sales order notes

Notes are unlimited text you can keep on the order.

- **Ship Instructions** — These notes print on the default sales order confirmation form.
- **Billing Notes** — These are internal notes that copy to the invoice.

## Sales order shipping

- **Ship to** — The ship to copies from the site record and instructs your shipping department where to deliver the products.
- **Ship method** — The ship method copies from the customer record and instructs your shipping department how to ship the items.
- **Incoterms** — The incoterms copy from the customer and define the responsibilities of exporters and importers in the arrangement of shipments and the transfer of liability involved at various stages of the transaction.

## Sales order billing

- **Bill to** — Instructs your billing department where to send invoices and statements. This copies from the customer’s bill to address.
- **Contact** — The primary customer contact for the order that copies from the customer record.
- **Payment terms** — The agreed finance terms with the customer on this order. This copies from the selected customer.

## Sales order taxes

*Tax tab on sales order form*

Tax rates are automatically imported and calculated on a sales order when it is flagged as taxable, when one or more lines with amounts are flagged as taxable, and there are tax rates set up that correspond with the bill to address on the order. By default the order is flagged taxable if the customer record is flagged as taxable. Likewise lines are flagged taxable when the products on them are flagged taxable. The shipping taxable flag on the tax lines determines whether the shipping cost is also taxed.

> See also[How to use taxes](#how-to-use-taxes)

## Sales order timeline

The sales order timeline tab shows the schedule of allocated work orders for all sales order lines in a Gantt chart format so you can easily see the relationship of time between work orders. Clicking on any node will open the form for that supply or detail record so you can view it in more detail or edit it.

*Timeline tab on the sales order form*

When you check “Show detail,” in addition to work order relationships, the Gantt chart will show planned orders, and purchase orders needed to complete the work orders as inputs on the same level. To see the operation timeline detail for work orders, click on a work order node.

*Sales order timeline with “Show Detail” checked*

> See alsoCalculate due date on sales order lineWork order schedule type[Work order timeline](#work-order-timeline)

## Sales order comments

*Sales order comments describing a deallocation event*

You can add comments for historical tracking of events relating to a sales order. Comments will be automatically created when supply gets deallocated for any reason so if, for example, a material that was allocated to the sales order was deallocated because the supply was deleted or used elsewhere, you will have a record of how and why that happened and by whom.

## Sales order history

*History tab on sales order form*

The history on sales orders helps you understand what has been shipped and what has been invoiced against a sales order. In the example shown above a shipment was made that has been invoiced where you can see both the quantities and values of the items shipped including taxes. You can also easily jump to the invoice from the link to learn more about its status. The second shipment hasn’t yet been invoiced, so does not have a dollar value yet. The history will also show prepaid invoices against the order if there are any.

> See also[How the shipping life cycle works](#how-the-shipping-cycle-works)[How the billing cycle works](#how-the-billing-cycle-works)

## Sales order audit

- **Sales Rep** — The employee that is responsible for the order. If the currently logged in user account is associated with an employee flagged with “Is Sales Rep” equals true, then the sales rep will default to their employee account. Otherwise, the list of potential employees that can be assigned is filtered on all employees where “Is Sales Rep” equals true.
- **Created By** — The user account who created the order.
- **Updated** — The last time the order was updated.
- **Updated By** — The user account who last updated the order.
- **Confirmation Is Printed** — Flagged true when the order confirmation has been successfully printed or downloaded.
- **Confirmation Print Time** — The time the order confirmation was successfully printed or downloaded.
- **Confirmation Printed By** — The user account who successfully printed or downloaded the sales order confirmation.
- **Picklist Is Printed** — Flagged true when the order confirmation has been successfully printed. This flag determines whether the order appears on the orders due and on floor worksheets in the Ship workbook.
- **Picklist Print Time** — The time the order picklist was successfully printed.
- **Picklist Printed By** — The user account who successfully printed the sales order picklist.

## How the sales order life cycle works

*When you close the sale, the work has just begun!*

Sales orders are used to keep track of products you are selling to a customer including but not limited to pricing, billing, delivery date and shipping information. You can print a confirmation form to send to the customer and a pick list for the shop floor to use to gather and stage the order items for shipping. Relevant data from the order copies to shipments and invoices, so it defines the pattern for everything having to do with the sale.

*Sales order’s role in the order to cash cycle*

Note: your workflow patterns may differ. See alternate workflows for more information.

Sales orders can be in one of the seven states shown below, where they generally flow from incomplete to closed, though some statuses are optional depending on the business process.

*Sales order status list*

The statuses work as follows:

- **Incomplete** — This is the default state of sales orders. While in this state any items on the order cannot be planned or shipped. This is a good state to leave the order in when you want to create some record that you’ve received an order from a customer, but information such as billing, or products data are incomplete. If you create a new product to deliver to the customer that takes time to engineer, you can create the order with the product number, but leave the order status as incomplete until you are ready to purchase and manufacture materials.
- **Pending** — When the sales order is in this state, the order is automatically planned where planned orders and work orders are created if necessary. Sales orders move into this state when the start action is executed, or if they are already active then unreleased. When a sales order is pending, it cannot be shipped.
- **Active** — Sales orders in this state can be shipped and are changed to this state when they are released. Typically, this is also the time the sales order promise date is set, and confirmation forms are sent to the customer.
- **On hold** — A sales order can be put in an on-hold status when it is in pending, active or back-order status. This will stop a sales order, and optionally its constituent work orders that are underway, from proceeding. This can be useful, for example, if credit, engineering, or approval problems arise that require intervention before any further transactions should be made. On hold is an on/off state separate from the order status, so the order remains in its previous status while on hold, but the red hand icon shows the on-hold condition. An order on hold cannot be shipped. When putting a sales order on hold, there is also an option to put child work orders on hold, so any production transactions are halted as well.
- **Shipping** — Sales orders automatically change to a “Shipping” state when a shipment is created for the order. This status is mostly informational, but also prevents changing quantities while the order is in this status.
- **Back Order** — This is an optional status that a sales order will go into after a shipment is shipped if the quantities of items were not shipped complete. However, this only happens if the shipment setting “Use back order” is on. Otherwise, the order goes back to an active state. The purpose of back order is to make it easy to identify active sales orders that have at least shipped partially.
- **Closed** — The order changes to closed when all quantities have shipped complete, or if it is manually closed. At this point the sales order is read only for historical purposes and no further shipments may be made on it.

> See also[Sales order](#sales-order-header)[How the shipping cycle works](#how-the-shipping-cycle-works)Sales order shipment[How the billing cycle works](#how-the-billing-cycle-works)Invoice

## Sales order backlog

By default this lists all active sales orders sorted from oldest to newest. All sales order actions can be performed from selections on this list.

> See also[How the sales order life cycle works](#how-the-sales-order-life-cycle-works)[Sales line backlog](#sales-line-backlog)[Sales order](#sales-order-header)

## Sales line backlog

By default this lists all active sales order lines sorted by due date. This list can be helpful for evaluating the open quantities and amounts of particular products.

> See also[How the sales order life cycle works](#how-the-sales-order-life-cycle-works)[Sales order backlog](#sales-order-backlog)[Sales order](#sales-order-header)

## Closed sales orders

This is a historical list of sales orders that can be viewed for investigation and auditing purposes. Closed sales orders are read only, so no action can be taken on them.
