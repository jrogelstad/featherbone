# Outside process shipments

## Outside process shipment actions

If Ship Engine integration is enabled, this will create and print a ship label on demand. If a ship label was already created, it will reprint the label.

If Ship Engine integration is enabled, this will void the created ship label. See Ship Engine’s documentation on the policy of crediting refunds for voided labels.

Prints a pack slip using the form specified in buy settings.

Completes the shipment transaction which in the case of an outside process shipment includes:

- Incrementing shipment quantity on the purchase order lines.
- Creating on operation completion on related work orders indicating the related operation has started, if not already so indicated.
- Printing a pack slip if buy settings are flagged to do so.
- Marking the shipment as shipped and read only.

## Outside process shipment header

- **Number** — A unique order identifier auto generated on save. All shipments start with “SH-“.
- **Purchase Order** — Purchase order against which the outside process is shipping.
- **Shipped By** — The employee who physically shipped the order.
- **Ship Date** — The date the order is scheduled to be or was picked up.
- **Site** — The site the shipment is shipped from, copied from the purchase order. If Ship Engine integration is enabled, this will also facilitate cost calculations by specifying the distance from the shipping start location.
- **Ship To** — The address the shipment is being shipped to. If Ship Engine integration is enabled, this will print on the ship label and facilitate cost calculations for the shipping provider by calculating distance from the shipping location.
- **Reference** — A document reference from the supplier, usually their sales order number. Copies from the purchase order.
- **Ship Method** — The ship method copies from the purchase order record and indicates how the order will ship. If Ship Engine integration is enabled, it will dictate what shipping provider to create a ship label against and the cost..
- **Package Type** — If Ship Engine integration is enabled, this will facilitate cost calculations for the shipping provider.
- **Ship Weight** — The sum of the weights of the products shipped any their containers. If Ship Engine integration is enabled, this will facilitate cost calculations for the shipping provider.

## Outside process shipment lines

- **Ship All** — Populate all lines with the remaining quantity due to ship on the order.

- **Line** — Auto generated sequential line number.
- **Item** — The the service being done to the shipped items.
- **Shipped** — The quantity being shipped on this shipment.

Additional attributes are visible when opening up the line-item detail form.

- **Details** — The quantity and location the items are being shipped from. Only available on enterprise edition and required when location control is enabled on the ship from site.

## Outside process shipment containers

When using Ship Engine integration, specific containers provided by your carrier, including envelopes and box types, will be imported that you may select as package types. These package types are used for generating ship labels and shipment costs on your shipment since the carrier knows the exact dimensions of the package. However, if you do not use a standard package type supplied by your carrier, you will need to select the CUSTOM package type and specify the of containers and weights used so a shipment label may be generated. Note that some carriers only allow one container per shipment. This is not a limitation of Job Shop, but rather a limitation of the shipper’s label processing system.

- **Number (#)** — Automatically generated container number.
- **Container** — A product with the flag Is Container set to true. When selected, the length width and height dimensions of the product will be referenced in the container row, which in turn is used for creating shipment labels.
- **Quantity** — The quantity of items within the container based on the sum of quantities entered in the container quantities child table.
- **Weight** — The weight of the container.

- **Product quantities** — You can optionally add the quantity detail of products that are in each container. When you do this the shipment line quantities will be automatically be updated, so if you choose to enter container quantity detail this should be the only place you enter quantities. If you accidentally update shipment quantities such that they don’t match the container quantities, you will not be allowed to save the shipment until this is corrected. However, if you don’t enter container quantity detail at all, this check will be skipped.

## Outside process shipment tracking

When Ship Engine integration is enabled, the information on this tab will be automatically populated when a label is created.

- **Label Id** — A read only unique label identifier created by Ship Engine when a label is printed. If you need to reprint a label, this identifier is used as a reference determine which label is being reprinted.
- **Tracking Number** — The carrier’s tracking number automatically populated when a label is printed. This can be manually entered, or scanned in with a keyboard wedge bar code reader, if you are not using Ship Engine integration.
- **Label Void** — Read only indicator that flags to true when a printed label is voided. If the label is void and you print a label, a new label will be created with a new identifier and tracking information.
- **Tracking URL** — The URL that can be used to see the tracking status of the shipment on the carrier’s website.

## Outside process shipment audit

- **Created** — The time the shipment was created.
- **Created By** — The user account who created the shipment.
- **Updated** — The last time the shipment was updated.
- **Updated By** — The user account who last updated the shipment.
- **Is Printed** — Flagged true when the shipment has been successfully printed.
- **Print Time** — The time the shipment was successfully printed.
- **Printed By** — The user account who successfully printed the shipment.
