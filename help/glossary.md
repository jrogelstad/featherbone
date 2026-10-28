# Glossary

## Feather

A record type or class in the Featherbone definition system. Product, Work Order and Inventory Transaction are all examples of feathers. All worksheet pages in Featherbone are of a particular feather, as are relations associated with it. For example, Unit (of measure) is a feather relation on Products.

## Natural Key

The natural key is a unique number, code or other text information that is keyed in or otherwise visible on a relation within Featherbone. The natural key appears as a hyperlink on lists.

Site code, item number and unit of measure code are natural keys with hyperlinks on this list of inventory items

## Relation

A relation is a link between a record on one table with that on another. It acts as a kind of “pointer” to other related information in the system. For example, “supplier” is a relation on purchase order. Relations are visible hyperlinks on lists and a field with a special button to the left of the text on forms.

Supplier, site and contact relations on the purchase order form

On forms the natural key of the relation is in a text field, and additional label information is shown below that. In the above example the name of the supplier, the site description, and contact phone and email are shown as additional label information from the relation.

> See also[Feather](#feather)

## Regular Expression

From Wikipedia:

A regular expression (shortened as regex or regexp), sometimes referred to as rational expression, is a sequence of characters that specifies a match pattern in text. Usually, such patterns are used by string-searching algorithms for “find” or “find and replace” operations on strings, or for input validation. Regular expression techniques are developed in theoretical computer science and formal language theory.

Regular expressions are used in Featherbone Job Shop searching and filtering.
