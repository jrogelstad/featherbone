# Services

## Service general attributes

- **Number** — A unique identifier for the service. You can change the number until the time it is shipped, at which point it becomes read only.
- **Unit** — The unit of measure used for tracking quantity. You can only change the unit when there is no active supply or demand for the service.
- **Group** — A general purchase classification that can be used for filtering, sorting, and reporting. There is no business logic dependent on this attribute.
- **Status** — Controls the ability to use the service in planning and transactions. See the item life cycle.
- **Drawing Link** — A document reference to an external URL or file such as a Drop Box, Google Drive or Microsoft One Drive location. Supported file types are .pdf, .jpeg, .gif, and .png.

## Service planning attributes

- **Is Fractional** — Use this flag to indicate when you can transact a service in less than whole units. When this is false, but a fraction of the service is needed, the demand quantity will be rounded up to the next whole number.

For example, suppose you send steel tubes out to be chromed and you are charged by the foot while the pieces your need chromed are varying lengths. If the lengths were to add up to something like 9.38 feet, but is fractional were false, the demand would be rounded up to 10 feet.

- **Primary Site** — You must set a primary site for the service to be valid. This specifically describes a warehouse or plant where you specifically purchase this service. If you do not specifically define a site record for the primary site, Job Shop will create one automatically when you save the service.
- **Sites** — Job Shop allows you to define multiple sites where you can use a service, along with specific behavior for each site as described below.
- **Lead time** — The typical number of days it takes for the service to be performed from site including shipping out, processing and shipping back. Lead time is used to calculate an estimated promise date in order entry, and for calculating scheduled requirement and due dates for child work orders and planned orders.
- **Minimum Quantity** — The default minimum make or buy quantity when creating planned orders or work orders for the product.
- **Order increment** — Also known as “lot size” in manufacturing jargon, planning for purchase orders and work orders will be done in multiples of this number.

For example, the case above that describes epoxy used in making widgets may be the sort of reasoning behind using order increment. It may, for example, make sense to set an order increment of 4 for widgets to minimize the waste of epoxy.

These attributes are visible when you open the detail form for a site row.

- **Maximum order quantity** — This number dictates when one planned order or work order is split into multiple orders.

## Service cost attributes

- **Category** — Used for filtering and reporting only. Category has no business logic impact.
- **Economic Order Quantity (EOQ)** — Informational only for services.
- **Service Cost** — Per unit cost of the service.

## Service text

Text fields provide additional description information that can be used on printed documents.

## Service shipping attribute

- **Weight** — The weight is used on shipments to calculate the total weight of shipment, which in turn is used by the Ship Engine integration when generating shipping labels.

## Service supplier attributes

Here you can define the suppliers you can purchase the service from including the supplier and manufacturer part number, a web address to a catalog page, and price breaks. If there is only one supplier defined, that supplier will be the default for planned orders. If there are multiple you will need to define the which is the primary, or otherwise the first in the list will be used.

Price breaks are set in the supplier item detail form. Planned orders and purchase orders will calculate which price to use automatically based on the quantity ordered if price breaks are defined.

## Service documents

Besides the drawing, you can link multiple other document URLs for reference concerning the service.

## Service conversions

Use service conversions to define service specific unit of measure conversions such as the number of eaches per case for purchasing and use on operations. Universal conversions such as fluid ounces to gallons or feet per yard should be done using global conversions.

Service conversions work exactly the same way as product conversions. For an example see the page on product conversions.
