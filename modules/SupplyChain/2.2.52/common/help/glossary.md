# Glossary

## Backflush

An automatic transaction that records product demands required on a work order as being taken from inventory and consumed by the work order. A backflush may happen on either an operation completion or a work order receipt, depending on how material requirements on the work order are set up.

## Demand

A record that calls upon certain products or services that are needed to execute a business transaction. Sales order lines are a demand to ship goods and work order material requirements are a demand for products to make another product.

> See also[Dependent Demand](#dependent-demand-definition)[Demand Signal](#demand-signal-definition)

## Demand Signal

An indicator that demand is needed for a particular product. These take many forms in Job Shop:

- The inventory worksheet in the Stock workbook shows the sum of demand for a particular product.
- The reorder worksheet in the Plan workbook shows products sites with a planning policy of reorder point that are projected to fall below their reorder point based on demand.
- The shortages worksheet in the Plan shows products sites with a planning policy of reorder point that are projected to fall below safety stock based on existing demand.
- Planned purchase and work orders show signals to buy or make a specific quantity of a product to satisfy a specific demand. These are automatically created for product sites with planning policy of plan to order or make to order.
- Alerts are created when projected quantities fall below a reorder point, safety stock or negative inventory thresholds, or when allocations against demands are removed before they are satisfied.

> See also[Demand](#demand-worksheet)[Dependent Demand](#dependent-demand-definition)

## Dependent Demand

Demand needed by order that exists to satisfy an upstream demand. In Job Shop, work order materials are dependent demand. For example, suppose you have a sales order demand to ship bicycles and a work order to make bicycles ship on that order. The work order to build bicycles calls for wheels, and that call for wheels is dependent demand.

> See also[Demand](#demand-worksheet)[Demand Signal](#demand-signal-definition)

## Economic Order Quantity (EOQ)

The quantity used for costing purposes which presumes the ideal balance between minimizing setup time to make a product, without producing excess amounts of inventory that may go unused.

## Supply

A record that reports on products or services that are currently or will be available in the future. Inventory, Purchase Order lines, and Work Orders are all types of supply in Job Shop.
