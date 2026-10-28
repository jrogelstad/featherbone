# Authorizations

## Feather authorizations

These are data level authorizations that are set by the system on all feathers in Job Shop. To grant access, you must add one of the appropriate roles to the user account that needs it. The administrator role is a member of all other roles.

| Feather \ Role | Create | Read | Update | Delete |
| --- | --- | --- | --- | --- |
| **Invoice** |  |  |  |  |
| Finance | ✓ | ✓ | ✓ | ✓ |
| Sales Representative |  | ✓ |  |  |
| Sales Manager | ✓ | ✓ | ✓ |  |
| **Sales History** |  |  |  |  |
| Finance |  | ✓ |  |  |
| Sales Representative |  | ✓ |  |  |
| Sales Manager |  | ✓ | ✓ |  |

| Feather \ Role | Create | Read | Update | Delete |
| --- | --- | --- | --- | --- |
| **Planned Purchase** |  |  |  |  |
| Buyer | ✓ | ✓ | ✓ | ✓ |
| Everyone |  | ✓ |  |  |
| Purchase Manager | ✓ | ✓ | ✓ | ✓ |
| **Purchase Order** |  |  |  |  |
| Buyer | ✓ | ✓ | ✓ | ✓ |
| Everyone |  | ✓ |  |  |
| Purchase Manager | ✓ | ✓ | ✓ | ✓ |
| **Purchase Order Receipt** |  |  |  |  |
| Buyer | ✓ | ✓ | ✓ | ✓ |
| Everyone |  | ✓ |  |  |
| Purchase Manager | ✓ | ✓ | ✓ | ✓ |
| Inventory Clerk | ✓ | ✓ | ✓ |  |
| Inventory Manager | ✓ | ✓ | ✓ | ✓ |
| **Supplier** |  |  |  |  |
| Everyone |  | ✓ |  |  |
| Purchase Manager | ✓ | ✓ | ✓ | ✓ |

| Feather \ Role | Create | Read | Update | Delete |
| --- | --- | --- | --- | --- |
| **Alert** |  |  |  |  |
| Administrator |  | ✓ |  | ✓ |
| Everyone |  | ✓ |  |  |
| **Carrier** |  |  |  |  |
| Everyone |  | ✓ |  |  |
| Sales Manager | ✓ | ✓ | ✓ | ✓ |
| Purchase Manager | ✓ | ✓ | ✓ | ✓ |
| **Employee** |  |  |  |  |
| Administrator | ✓ | ✓ | ✓ | ✓ |
| Buyer |  | ✓ |  |  |
| Production Manager |  | ✓ |  |  |
| Sales Manager |  | ✓ |  |  |
| Purchase Manager |  | ✓ |  |  |
| Inventory Clerk |  | ✓ |  |  |
| Inventory Manager |  | ✓ |  |  |
| Human Resource Manager | ✓ | ✓ | ✓ |  |
| **Freight Code** |  |  |  |  |
| Engineer | ✓ | ✓ | ✓ | ✓ |
| Everyone |  | ✓ |  |  |
| Sales Manager | ✓ | ✓ | ✓ | ✓ |
| Purchase Manager | ✓ | ✓ | ✓ | ✓ |
| **Inco Terms** |  |  |  |  |
| Everyone |  | ✓ |  |  |
| Sales Manager | ✓ | ✓ | ✓ | ✓ |
| Purchase Manager | ✓ | ✓ | ✓ | ✓ |
| **Package Type** |  |  |  |  |
| Everyone |  | ✓ |  |  |
| Sales Manager | ✓ | ✓ | ✓ | ✓ |
| **Ship Method** |  |  |  |  |
| Everyone |  | ✓ |  |  |
| Sales Manager | ✓ | ✓ | ✓ | ✓ |
| Purchase Manager | ✓ | ✓ | ✓ | ✓ |
| **Tax Type** |  |  |  |  |
| Everyone |  | ✓ |  |  |
| Sales Manager | ✓ | ✓ | ✓ | ✓ |
| **Terms** |  |  |  |  |
| Everyone |  | ✓ |  |  |
| Finance | ✓ | ✓ | ✓ | ✓ |
| Sales Manager | ✓ | ✓ | ✓ | ✓ |
| Purchase Manager | ✓ | ✓ | ✓ | ✓ |

| Feather \ Role | Create | Read | Update | Delete |
| --- | --- | --- | --- | --- |
| **Labor Resource** |  |  |  |  |
| Engineer | ✓ | ✓ | ✓ | ✓ |
| Finance |  | ✓ | ✓ |  |
| Production Manager | ✓ | ✓ | ✓ | ✓ |
| **Machine Resource** |  |  |  |  |
| Engineer | ✓ | ✓ | ✓ | ✓ |
| Finance |  | ✓ | ✓ |  |
| Production Manager | ✓ | ✓ | ✓ | ✓ |
| **Product** |  |  |  |  |
| Engineer | ✓ | ✓ | ✓ | ✓ |
| Everyone | ✓ | ✓ | ✓ | ✓ |
| **Proposed Cost** |  |  |  |  |
| Engineer |  | ✓ |  |  |
| Finance |  | ✓ |  |  |
| Purchase Manager |  | ✓ |  |  |

Physical count functionality is only available in Enterprise edition.

| Feather \ Role | Create | Read | Update | Delete |
| --- | --- | --- | --- | --- |
| **Physical Count** |  |  |  |  |
| Everyone |  | ✓ |  |  |
| Inventory Clerk |  | ✓ | ✓ |  |
| Inventory Manager |  | ✓ | ✓ | ✓ |

| Feather \ Role | Create | Read | Update | Delete |
| --- | --- | --- | --- | --- |
| **Operation Completion** |  |  |  |  |
| Production Manager | ✓ | ✓ | ✓ | ✓ |
| Shop Floor User | ✓ | ✓ | ✓ |  |
| **Outside Process** |  |  |  |  |
| Everyone |  | ✓ |  |  |
| **Planned Work Order** |  |  |  |  |
| Production Manager | ✓ | ✓ | ✓ | ✓ |
| **Work Order** |  |  |  |  |
| Everyone |  | ✓ |  |  |
| Production Manager | ✓ | ✓ | ✓ | ✓ |
| **Work Order Receipt** |  |  |  |  |
| Everyone | ✓ | ✓ | ✓ | ✓ |

| Feather \ Role | Create | Read | Update | Delete |
| --- | --- | --- | --- | --- |
| **Operation Completion** |  |  |  |  |
| Production Manager | ✓ | ✓ | ✓ | ✓ |
| Shop Floor User | ✓ | ✓ | ✓ |  |
| **Outside Process** |  |  |  |  |
| Everyone |  | ✓ |  |  |
| **Planned Work Order** |  |  |  |  |
| Production Manager | ✓ | ✓ | ✓ | ✓ |
| **Work Order** |  |  |  |  |
| Everyone |  | ✓ |  |  |
| Production Manager | ✓ | ✓ | ✓ | ✓ |
| **Work Order Receipt** |  |  |  |  |
| Everyone | ✓ | ✓ | ✓ | ✓ |

| Feather \ Role | Create | Read | Update | Delete |
| --- | --- | --- | --- | --- |
| **Allocation** |  |  |  |  |
| Buyer |  | ✓ | ✓ | ✓ |
| Everyone |  | ✓ |  |  |
| Production Manager | ✓ | ✓ | ✓ | ✓ |
| Sales Representative | ✓ | ✓ | ✓ | ✓ |
| Sales Manager | ✓ | ✓ | ✓ | ✓ |
| Purchase Manager | ✓ | ✓ | ✓ | ✓ |

| Feather \ Role | Create | Read | Update | Delete |
| --- | --- | --- | --- | --- |
| **Project** |  |  |  |  |
| Everyone |  | ✓ |  |  |
| Project Manager | ✓ | ✓ | ✓ | ✓ |
| **Task** |  |  |  |  |
| Everyone | ✓ | ✓ | ✓ |  |

| Feather \ Role | Create | Read | Update | Delete |
| --- | --- | --- | --- | --- |
| **Customer** |  |  |  |  |
| Everyone |  | ✓ |  |  |
| Sales Representative | ✓ | ✓ | ✓ |  |
| Sales Manager | ✓ | ✓ | ✓ | ✓ |
| **Customer Category** |  |  |  |  |
| Everyone |  | ✓ |  |  |
| Sales Manager | ✓ | ✓ | ✓ | ✓ |
| **Sales Order** |  |  |  |  |
| Sales Representative | ✓ | ✓ | ✓ |  |
| Sales Manager | ✓ | ✓ | ✓ | ✓ |
| **Tax Rate** |  |  |  |  |
| Everyone |  | ✓ |  |  |
| Sales Manager | ✓ | ✓ | ✓ | ✓ |

| Feather \ Role | Create | Read | Update | Delete |
| --- | --- | --- | --- | --- |
| **Container** |  |  |  |  |
| Everyone |  | ✓ |  |  |
| **Sales Order Shipment** |  |  |  |  |
| Sales Representative |  | ✓ |  |  |
| Sales Manager | ✓ | ✓ | ✓ | ✓ |
| Inventory Clerk | ✓ | ✓ | ✓ | ✓ |
| Inventory Manager | ✓ | ✓ | ✓ | ✓ |

| Feather \ Role | Create | Read | Update | Delete |
| --- | --- | --- | --- | --- |
| **Ship Engine Carrier** |  |  |  |  |
| Administrator |  | ✓ | ✓ | ✓ |

| Feather \ Role | Create | Read | Update | Delete |
| --- | --- | --- | --- | --- |
| **Inventory** |  |  |  |  |
| Everyone |  | ✓ |  |  |
| Inventory Clerk |  | ✓ | ✓ |  |
| Inventory Manager |  | ✓ | ✓ |  |
| **Inventory Adjustment** |  |  |  |  |
| Everyone |  | ✓ |  |  |
| Inventory Clerk | ✓ | ✓ | ✓ | ✓ |
| Inventory Manager | ✓ | ✓ | ✓ | ✓ |
| **Inventory Transaction** |  |  |  |  |
| Everyone |  | ✓ |  |  |
| **Item Category** |  |  |  |  |
| Engineer | ✓ | ✓ | ✓ | ✓ |
| Everyone |  | ✓ |  |  |
| **Item Group** |  |  |  |  |
| Engineer | ✓ | ✓ | ✓ | ✓ |
| Everyone |  | ✓ |  |  |
| **Item Unit** |  |  |  |  |
| Engineer | ✓ | ✓ | ✓ | ✓ |
| Everyone |  | ✓ |  |  |
| **Location** |  |  |  |  |
| Everyone |  | ✓ |  |  |
| Inventory Manager | ✓ | ✓ | ✓ | ✓ |
| **Move Inventory** |  |  |  |  |
| Everyone |  | ✓ |  |  |
| Inventory Clerk | ✓ | ✓ | ✓ | ✓ |
| Inventory Manager | ✓ | ✓ | ✓ | ✓ |
| **Site** |  |  |  |  |
| Everyone |  | ✓ |  |  |
| Inventory Manager | ✓ | ✓ | ✓ | ✓ |

## Workbook authorizations

The default workbook authorization settings when a Job Shop database is created. These can be changed by anyone with a role to update a workbook.

| Workbook \ Role | Read | Update |
| --- | --- | --- |
| **Alerts** |  |  |
| Administrator | ✓ | ✓ |
| Everyone | ✓ |  |
| **Bill** |  |  |
| Finance | ✓ | ✓ |
| **Buy** |  |  |
| Administrator | ✓ | ✓ |
| Buyer | ✓ |  |
| Planner | ✓ |  |
| Purchase Manager | ✓ | ✓ |
| **Count** |  |  |
| Administrator | ✓ | ✓ |
| Inventory Clerk | ✓ |  |
| Inventory Manager | ✓ | ✓ |
| **Contacts** |  |  |
| Administrator | ✓ | ✓ |
| Everyone | ✓ |  |
| Purchase Manager | ✓ | ✓ |
| Sales Manager | ✓ | ✓ |
| **Design** |  |  |
| Administrator | ✓ | ✓ |
| Engineer | ✓ | ✓ |
| Everyone | ✓ |  |
| **Make** |  |  |
| Administrator | ✓ | ✓ |
| Planner | ✓ |  |
| Production Manager | ✓ | ✓ |
| **Plan** |  |  |
| Administrator | ✓ | ✓ |
| Buyer | ✓ |  |
| Production Manager | ✓ | ✓ |
| Purchase Manager | ✓ | ✓ |
| Sales Manager | ✓ | ✓ |
| Sales Representative | ✓ |  |
| **Report** |  |  |
| Administrator | ✓ | ✓ |
| Finance | ✓ | ✓ |
| **Sell** |  |  |
| Administrator | ✓ | ✓ |
| Sales Manager | ✓ | ✓ |
| Sales Representative | ✓ |  |
| **Settings** |  |  |
| Administrator | ✓ | ✓ |
| Human Resource Manager | ✓ |  |
| **Ship** |  |  |
| Administrator | ✓ | ✓ |
| Inventory Clerk | ✓ |  |
| Inventory Manager | ✓ | ✓ |
| Sales Manager | ✓ | ✓ |
| Sales Representative | ✓ |  |
| **Ship Engine** |  |  |
| Administrator | ✓ | ✓ |
| **Stock** |  |  |
| Administrator | ✓ | ✓ |
| Everyone | ✓ |  |
| Inventory Manager | ✓ | ✓ |
