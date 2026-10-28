# Inventory

## Inventory

By default the inventory worksheet lists all active product sites with the product type set to inventory. It provides information about the inventory status of products including on hand, on order, demand and projected quantities. As a visual warning, inventory records that are projected to fall below zero are colored orange while records with on hand quantities currently below zero are red.

*Inventory worksheet*

If you put the inventory worksheet in inline edit mode you can make direct adjustments to inventory. Just change the quantity to whatever it actually is and save. Featherbone will automatically make an inventory adjustment transaction for the difference between what the quantity was, and the quantity you entered.

*Adjusting the quantity with inline editing*

Note: Inline editing is only possible when location control (Enterprise edition only) is not enabled on the site of the record in question. When location control is enabled, you must make adjustments through the adjustment form to account for location detail.

Similarly, you can edit the on hand quantity directly for non location controlled inventory from the stock tab form. When the inventory worksheet is not in inline edit mode, double click on a row to open the form.

*Editing inventory quantity from the inventory plan form*

As with inline editing, Job Shop will automatically make an adjustment transaction after you save the change. Go to the inventory transactions worksheet to see the transaction.

*The top row in inventory transaction history shows the adjustment made in the form*

## Inventory by location

The inventory by location worksheet shows the current quantity of products in their respective locations. This worksheet is only available in Enterprise edition and is only populated when one or more sites have location control enabled. Records are read only and updated when inventory transactions are created.

*Inventory by location worksheet*

## Inventory transactions

Inventory transactions are a read only record of inventory movements in and out of Job Shop that are helpful to understand how inventory on hand inventory quantities and values got to their present amounts. Before and after quantities are recorded along with their value and the document that triggered the transaction. The following are the types of transactions that are possible:

- **Inventory Adjustment:** — Manual adjustment of inventory quantity.
- **Move Inventory:** — A move inventory transaction to move inventory from one location to another (Enterprise edition only).
- **Standard Cost Update:** — Recorded by a change of product cost when inventory exists. Only changes inventory value.
- **Physical Count:** — Adjustment caused by the posting of a physical count (Enterprise edition only).
- **Purchase Order Receipt:** — Recorded when a purchase order receipt is posted.
- **Work Order Receipt:** — Recorded when a work order receipt is posted.
- **Work Order Issue:** — Recorded when work order materials are backflushed, either when an operation completion is posted (Pro and Enterprise editions only) to which materials are related, or when a work order receipt is posted for materials not associated with an operation.
- **Shipment:** — Recorded when a Sales Order Shipment is shipped.

*Inventory transactions worksheet*

## Work order issue

Use the work order issue form to issue products from inventory to a specific work order. Only products with their inventory issue method set to manual will be able to be issued from this form. The process to use this form is to select the work order against which to issue, a particular operation to issue against if applicable (Pro and Enterprise editions only), enter quantities to issue and save. The document will automatically post inventory transactions on save.

*Work order issue form*

Run issue all to automatically populate the quantities with all the required quantities remaining that have not been issued.

This action records the transactions associated with a work order issue document as described above. Posting happens automatically when the document is saved. However, if the posting should fail you can use this action to reattempt the posting. For example, a post may fail if you have an active physical inventory count underway. In a case like this, you will have to post the adjustment after the count is complete.

The operation selector is only available on Pro and Enterprise editions and will allow you to select operations on the work order chosen. If no operation is selected, all the materials will be shown that are not associated with an operation on the work order. Otherwise, when you select an operation, only materials will be shown that are linked to operations on the work order material list.

If you enter negative quantities on the product rows return transactions will be created that return product quantities from the work order back to inventory.

## Inventory adjustments

Inventory adjustments are used to record a manual update of inventory on hand quantity.

*Inventory adjustments worksheet*

To make an adjustment, click New from the adjustments worksheet. You will be required to provide the product, site and quantity. By default the type is “In” which will increase the on hand quantity by the quantity of the adjustment. If you want to decrease the quantity make sure to select “Out.” If location control is enabled (Enterprise edition only) you will be required to include information about the locations affected by the adjustment. The total of the locations must equal the quantity of the adjustment. The location details will be populated with the product’s default location automatically, but can be changed by the user.

*Inventory adjustment form*

When you save the adjustment it will post automatically creating an inventory transaction record, or multiple transaction records if multiple locations are affected.

This action records the transactions associated with an adjustment as described above. Posting happens automatically when an adjustment is saved. However, if the posting should fail you can use this action to reattempt the posting. For example, an adjustment may fail to post if you have an active physical inventory count underway. In a case like this, you will have to post the adjustment after the count is complete.

## Inventory moves

Use the inventory move transaction to move products from one location to another on sites that are set with location control turned on (Enterprise edition only). From the move worksheet click New to create a new move transaction.

*Move inventory transaction form*

An inventory move record will automatically post an inventory transaction on save.

## How to use location control

Location control is useful in large physical spaces where it is necessary to know exactly where materials are received, stored, issued from and shipped from. Once it is turned on, all inventory for the site being enabled will require or use location information on all transactions. At a minimum a default location is required that will be used for all products and transactions. You can increase the level of detail for products by specifying specific default locations for particular products as described below. Be aware that if you use receiving, WIP or shipping locations, it is necessary to perform move transactions to keep information about these locations up to date.

Note: Location control is available only on the Enterprise edition of Job Shop.

You can create a location from any form that has the location attribute by clicking on the label button and selecting New. The form will look as shown.

*Location form*

The name can be anything but should be something employees in your shop can understand. In the example above it is a code that indicates an aisle, shelf and bin location. The description can describe the location in more explicit detail. The type options work as follows:

- **Nettable** — Inventory in this location is considered usable for the business.
- **Inspection** — Inventory in this location is included in the “In inspection” quantity calculated on its parent inventory record.
- **Blocked** — Inventory in a blocked location is not considered available for use so is excluded from the available and projected inventory calculations. This is a location where you would typically put material that is known to be defective where you still want to know you have it, but do not want it considered available for planning and use on the floor.

In the interest of keeping things simple for most companies, available, at inspection and blocked quantity calculations on the inventory record are not shown by default. However, if you use inspection or blocked locations, we recommend you add these columns to the inventory worksheet as pictured below.

*Adding supplemental quantity information to the inventory worksheet*

Note: If you add these columns, don’t forget to share your changes with other users!

To enable location control, open the site form for a site which you intend to enable location control.

*Location control tab on a site record form*

Check “Location Controlled” and select or create a new default location. When you save the site record, all products with inventory on hand will be moved to the default location. The location attributes on the site record work as follows:

- **Default Location:** — This is the default location for all inventory transactions, whether in or out, if no other locations are specified on the site or product level for special circumstances listed below.
- **Default Receiving Location:** — If populated, this is the default location purchase order receipts will be received into. Typically this is an inspection location where materials are held until they have been released from inspection.
- **Default WIP (work in process) Location:** — If populated, this is the default location that material requirements will be issued from on work orders. Work order issues happen when operations are completed for materials assigned to the operation, and when work orders are received for inventory materials that are not assigned to operations.
- **Default Ship Location:** — If populated, this is the location that materials will be issued from when shipments are shipped.

Product sites can have their own specific locations set for certain transactions.

*Product site detail*

Product site locations work as follows:

- **Default location:** — This is the default location for all transactions for this product for all transactions. As such it overrides the site default location. However, it does not override the site receiving or shipping locations if they are set.
- **WIP Location:** — This is the default location from which work order materials are issues for this product site. As such it overrides the site WIP location if it has been set.

To use Receiving, WIP and shipping locations your staff must record inventory move transactions to move products to the right location at the right time.

- **Receiving:** — Typically items are put in a receiving location that is inspection on receipt. Once inspection is performed, they should be moved to their stock location. Items that fail inspection should be moved to a blocked location until they are dispositioned.
- **Work in Process:** — Products issued from a WIP location should be moved to this location whenever a shop floor inventory location is physically replenished.
- **Ship:** — Products shipped from a ship location need to be moved to this location when they are picked to indicate they are staged for shipping.

## Stock settings

Weight unit of measure for products used in shipping calculations by the Ship Engine integration when creating labels.
