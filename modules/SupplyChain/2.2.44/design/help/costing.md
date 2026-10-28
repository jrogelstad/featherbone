# Costing and settings

## How the item life cycle works

Products define a type of physical item that you can buy, make, sell, and optionally carry in inventory. Specifically, products include bill of material and router* definition support that describe how a product is made, or in the case of a kit, what materials make up the kit when it is bought or sold.

Services define a type of work an outside processor can perform on a work order in lieu of your shop doing the work itself. These services are set on operations, when applicable, and copy down to work orders when they are created. It is up to you whether to track the progress of services in detail, but if you do decide to track them this is done by creating a purchase order tied to the work order service requirement and recording shipment and receipt of goods processed by the supplier. It’s notable that services cannot be held in inventory, and must be processed on a purchase-to-order basis.

Both products and services are a type of item and any purchase in Job Shop is likewise for an item. Job Shop organizes data this way so that a line on a purchase order can be either for a product or service but is handled the same way. Therefore, whenever you see a reference to an “item” in Job Shop, this is for a record that could be either a product or a service.

*The item life cycle*

As shown above, an item can be set to have one of three statuses that work as follows:

- **Pending** — This is the default status for new items. You should use pending when you are still designing your item and is not ready to be bought, made, or sold. You can roll up costs on pending items that are products, and products that contain pending products in their bill of material, but you may not use pending products in inventory, purchase orders, work orders or sales orders.
- **Active** — Items in this state can be used throughout the system for inventory, orders, planning and transactions. Once a product has transaction history or open or orders, it can no longer be deleted. Also, if a product has active inventory or orders, it cannot be changed to pending or inactive until the inventory is zero and all related orders are closed or deleted.
- **Inactive** — Items should be changed to this state when they are obsolete, and you no longer want to allow them to be used in your business. Inactive items have the same restrictions as pending ones, except that they cannot be used in cost roll-ups. The system will throw an error if you attempt to roll up costs on a product that contains an inactive product in its bill of materials.

> See also[How to set up products](#product-general-attributes)[How to set up services](#service-general-attributes)

## How to roll costs

Cost roll ups provide a way to summarize the cost of products that are manufactured based on the bills of materials and operations (if applicable) that are required to manufacture it. These costs are then used on financial reports to provide inventory, work in process and cost of goods sold values. You can roll up the cost of one product at a time, or all products at once. If you roll up one product, the indented bill of materials is checked for any changes at any level, and recalculated.

*Roll costs process flow*

The diagram above shows the roll up process where you are given an option to review and approve potential cost changes before committing to them, or to update them immediately.

If you do a cost roll up on a product where all the materials are purchased, this will cause a single level to roll up. Even a single level rollup, however, can be affected by many elements which we will describe in a detailed example.

For example, suppose we have a product “Axle spindle” that needs to be cut, milled on a CNC lathe, and packaged with associated hardware. Assume the axle has an economic order quantity (EOQ) set to 120, and we want to roll up the costs.

*Example manufactured axle spindle*

The operations to produce and package our spindle require a combination of in house and outside service work as follows:

| Task | Machine resource | Labor resource | Service | Setup hours | Run rate | Run unit | Machine capacity | Labor capacity | Yield |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Cut bar | Saw | Shop Labor |  | 0 | 126 | Units Per Hr. | 1 | 1 | 100.00 |
| Mill Bar | CNC Mill | CNC Oper. |  | 1 | 63 | Units Per Hr. | 1 | 1 | 95.24 |
| Heat Treat |  |  | Axle HT | 0 | 0 | Units Per Hr. | 1 | 1 | 100.00 |
| Package | Pack Line | Shop Labor |  | 0 | 120 | Units Per Hr. | 2 | 4 | 100.00 |

*Axle manufacturing operations*

Job Shop must calculate backward from the last operation considering the yield on each operation to determine how much quantity is needed from the preceding operation. The quantity in and out columns in the table below show the impact of yield. With an EOQ of 120 set for our spindle, and a milling yield of 94.25%, our operation quantities, run times like this:

| Operation | Yield | Quantity in | Quantity Out | Machine Hours | Labor Hours | Service Quantity |
| --- | --- | --- | --- | --- | --- | --- |
| Cut bar | 100.00 | 126 | 126 | 1 | 1 | 0 |
| Mill Bar | 95.25 | 126 | 120 | 1 | 1 | 0 |
| Heat Treat | 100.00 | 120 | 120 | 0 | 0 | 120 |
| Package | 100.00 | 120 | 120 | 2 | 4 | 0 |

*Calculated hours based on yield*

To calculate the cost of the work, we need to consider the costs of the resources that perform the work which are as follows:

| Cost resource | Resource type | Cost | Unit |
| --- | --- | --- | --- |
| Saw | Overhead | $0.00 | Hour |
| CNC Mill | Overhead | $20.00 | Hour |
| Pack Line | Overhead | $12.00 | Hour |
| Shop Labor | Labor | $30.00 | Hour |
| CNC Oper. | Labor | $40.00 | Hour |
| Axle HT | Service | $2.00 | Each |

*Cost factors*

Finally, based on the hours and costs we can calculate the total operational and per unit costs to produce 120 axles. We multiply the hours times the per hour rate of the resource, or service unit cost multiplied the number of units, to get total costs, then divide by 120 to arrive at the per unit cost.

| Operation | Total costs: Overhead cost | Total costs: Labor cost | Total costs: Service cost | Unit costs: Overhead cost | Unit costs: Labor cost | Unit costs: Service cost |
| --- | --- | --- | --- | --- | --- | --- |
| Cut bar | $0.00 | $30.00 | $0.00 | $0.00 | $0.25 | $0.00 |
| Mill Bar | $60.00 | $120.00 | $0.00 | $0.50 | $1.00 | $0.00 |
| Heat Treat | $0.00 | $0.00 | $360.00 | $0.00 | $0.00 | $2.00 |
| Package | $24.00 | $120.00 | $0.00 | $0.20 | $1.00 | $0.00 |
| Total | $80.00 | $270.00 | $240.00 | $0.60 | $2.25 | $2.00 |

*Calculated operation costs for axles*

The bill of material for our axle spindle is as follows:

| Material | Fixed quantity | Quantity per | BOM Unit of measure | Cost | Stock unit of measure | Operation |
| --- | --- | --- | --- | --- | --- | --- |
| Stainless bar | 10 | 15 | Centimeter | $10.00 | Meter | 1 |
| Castle nut | 0 | 1 | Each | $0.50 | Each | 4 |
| Washer | 0 | 1 | Each | $0.10 | Each | 4 |
| Cotter pin | 0 | 1 | Each | $0.02 | Each | 4 |
| Box | 0 | 1 | Each | $0.50 | Each | 4 |

*Bill of materials*

Job Shop calculates the per unit material costs associated with operations as follows:

(Fixed qty. + Qty. per * Qty. In) * Conversion ratio * Unit cost / Qty. In

For materials not associated with an operation, the EOQ quantity is the multiplier:

(Fixed qty. + Qty. per * EOQ) * Conversion ratio * Unit cost / EOQ

Note: If you mark a product on the bill of material as “Is Fractional” as false on its product definition, Job Shop will round the quantity required up to the nearest whole number, which can affect cost roll up results.

In our axle example, we’ll use the calculated hours table above as a reference for input quantities to calculate the following material requirements and costs:

| Material | Required quantity | Stock unit of measure | Total cost | Material unit Cost |
| --- | --- | --- | --- | --- |
| Stainless bar | 12.75 | Meter | $127.50 | $1.0625 |
| Castle nut | 120 | Each | $60.00 | $0.5000 |
| Washer | 120 | Each | $12.00 | $0.1000 |
| Cotter pin | 120 | Each | $2.40 | $0.0200 |
| Box | 120 | Each | $60.00 | $0.5000 |
| Total |  |  | $261.90 | $2.1825 |

*Material costs*

Finally, we can calculate the total unit cost as follows:

material unit cost + overhead unit cost + labor unit cost + service unit cost = total unit cost

Referencing values in operation and material cost tables above, the unit cost is calculated as follows:

$2.1825 + $2.25 + $0.60 + $2.00 = $6.4925

## Global conversions

The Conversions tab within the Design workbook lists all global unit of measure conversions from one item unit to another. These are used to calculate impact on the stock unit of measure for a product when a different unit is called for than the stocking unit. For example the stock unit for paint may be gallons, but a bill of material might call for a certain number of fluid ounces to paint a product. These conversions allow the calculation of how many gallons will be needed to make a particular product automatically. Global conversions must be between two item units of the same dimension, such as length, area or volume. So, for example, you can convert centimeters to meters because these are both lengths, but you cannot convert centimeters to liters where the first is a length and the second is volume.

The dimension is set on the item unit itself as pictured below.

*Dimension options on the item unit form*

Some example conversions from the demo database are shown below.

*Conversions from the demo database*

The ratio is the number of units required of the “From Unit” needed to have one of the “To Unit.” In the cases above we have defined there are 2 eaches per pair, 128 fluid ounces per gallon, and 9 square feet per square yard. The implementation is bi-directional meaning that once you have defined a conversion one way, you don’t have to define it in the opposite direction. For example in the cases above, we don’t also need to define how many gallons there are in a fluid ounce as Job Shop will already be able to figure that out if it needs to based on the existing fluid ounces per gallon record.

Sometimes it is necessary to calculate between two different dimensions such as how many square inches (area) there are in a linear foot (length) of fabric, paper, or vinyl sheet. However, the trick with cases like this is the number of square feet depends on the width of the product being stocked in linear feet.

*The number of square inches in a linear foot of vinyl depends on the width of the product*

In other cases the dimension may be the same such as eaches (quantity) per case (also quantity), but still vary by product. In both situations, the conversion needs to be defined on the product rather than globally. For more information, see product conversions here.

## Design settings

Use design settings to define default behaviors for product set ups.

*Design settings form*

The default primary site for new products.

The default planning policy for manufactured products. Click here to learn more about planning policy.

The default planning policy for manufactured products. Click here to learn more about planning policy.

The default issue method on product site inventory settings.
