# Drawings and engineering bill of material

An engineering drawing is a 3D model of a product. Open one from the CAD sheet in Job Shop, or import a STEP, STL or three-cad-viewer .json file into a new one. Everyone can view drawings; only engineers can create, change or delete them.

## Drawing attributes

- **Label** and **Revision** — Together they name the drawing, for example *Cabinet rev 2*. Each combination is used by one drawing only.
- **Units** — The units the model was drawn in.
- **Product** — The product the drawing is of. A drawing belongs to one product; a product can be pointed at by only one drawing at a time.
- **Replace the drawing the product already has** — See below.
- **Source** — The name of the file the model was imported from.
- **Notes** — Free text about the drawing.

## The product's drawing link

When you save a drawing with a product, the product's **Drawing Link** is set to the drawing for you. If you change the drawing's product, the old product's link is cleared and the new product's link is set. Deleting the drawing clears the product's link.

If the product already has a different drawing, the save is refused with a message naming that drawing. To take the link over, check **Replace the drawing the product already has** and save again. The box clears itself after the save. A newer revision of the drawing the product already has takes over without asking.

## Engineering bill of material

The second tab lists what the model is made of, as a tree like an indented bill of material. It is read from the model's tree each time the model changes.

- A line is a part or an assembly. The top assembly of the file is the product itself and is not listed. The solids a part is made of are not listed.
- The tree opens with every assembly closed. Click the arrow beside an assembly's name to show the lines under it. The lines you have opened stay open while you are on the drawing.
- Lines follow the order of the file, shown as **Seq. #**.
- Parts of the same name in the same place are one line, and **Qty** counts them.
- **Name** is the name in the file and cannot be changed.
- **Sync** marks the lines that are to be kept in step with the manufacturing bill of material of the drawing's product. When a model is first read, the first level is marked and the levels below it are not. Check or clear it on any line.
- **Product** is the product the line stands for. If a product's number is exactly the line's name, it is picked for you, now and on any later save, at any level. Otherwise choose it yourself.
- A warning icon marks a line that is marked to sync but has no product, or that is no longer in the model. Hover over it to see which. A line that is not marked to sync does not need a product.

### Importing a new revision of the model

Lines are matched by their place in the tree and name. Lines that are still in the model keep the product and the sync setting you chose; new parts are marked to sync only if they are on the first level. Lines that are no longer in the model stay, marked as not in the model, so your mapping is never lost; delete them yourself if you no longer want them.
