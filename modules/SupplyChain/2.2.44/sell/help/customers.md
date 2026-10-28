# Customers, taxes and settings

## Customers

Customers are the individual or organizational entities you sell to which includes contact and address information. Almost all data set on customers is default values for sales orders and invoices.

## Customer contacts

A list of all customer contacts and their associated customer. Useful for quick searching by name, location, customer etc.

## How to use taxes

*Not written yet.* An article may have been published since: [https://featherbone.com/?knowledgebase=how-to-use-taxes](https://featherbone.com/?knowledgebase=how-to-use-taxes).

## Tax rates

Tax rates are used to calculate taxes on sales order and invoices based on cross referencing the bill to address with the rates assigned to matching tax rates.

You can create entries manually if you only sell in limited geographic locations. However, if you have a national sales footprint, you may want to consider a subscription to Zip2Tax tables so you can import tax rates from the over 70,000 jurisdictions in the United States using the Import Zip 2 Tax action. This action supports importing the csv Full Breakout format. There is no need to unzip the file. Simply select Import Zip2Tax and select the zip file downloaded from the Zip2Tax web site.

> See also[How to use taxes](#how-to-use-taxes)

## Sell settings

- **Confirmation** — The layout to use when creating a sales order confirmation PDF.
- **On Release** — An action to automatically run when a sales order is released. The options are:
- **Do nothing** — Don’t take any additional action.
- **Email** — Send an email with the sales order confirmation PDF attached.
- **Download** — Save the sales order confirmation PDF to your downloads folder.
- **Open PDF** — Open the sales order confirmation PDF in a new browser tab.
- **Print** — Print the sales order confirmation PDF.
- **Mail Text** — The default text to appear in the body of email when you send a sales order.
