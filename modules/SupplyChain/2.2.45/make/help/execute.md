# Dispatch and completions

## Dispatch list

Dispatch lists* are helpful to communicate to your shop floor what work order operations are available to be worked on. Furthermore, they are set by default to allow direct editing so that operators can record completions by simply clicking on a row, entering a quantity to complete, and saving. From this entry an operation completion will be automatically created and posted.

*Standard dispatch list with quantities to complete being entered*

By default what is displayed on the list are all active or in-process operations with available quantities to be completed. When a work order that has any operations is released only the first operation displays as having available quantity to be worked on. Once quantities have been reported on the first operation the next operation, if there is one, shows as having available quantity to complete and is added to the dispatch list. When all quantities are complete on an operation, it closes and falls off the list.

Note there can be a lag of several seconds between when the completion quantity is saved until the row updates, is replaced, or removed from the screen due to the posting of the completion. This is because posting can involve performing several related transactions and updates on the work order that can take a little time. You can view the status of operation completions on their operation completion worksheet.

If there is any workbook in Job Shop that cries out for local configuration it is the Execution workbook and the dispatch worksheet. Shop floor operators are only interested in seeing the work that is relevant to their equipment or department. Likewise production managers generally want to make work lists as simple as possible to avoid errors. So you will likely want to tailor a variety dispatch lists named for specific work centers with filters that are relevant to them. For this your administrator will have to become acquainted with how to modify workbooks and worksheets to fit your work environment. Some suggested tactics you can take:

- Copy the dispatch list worksheet in the Execution workbook so that you have a dedicated worksheet for each of your work centers, each one filtering on the labor resources, machine resources or description relevant to that team.
- Copy the Execution workbook, one for each work center, and set the dispatch list to filter as appropriate for the team it is intended for. With this approach you can set authorization on the work book for specific user accounts so they will only see the ones appropriate to their work.
- Alter the columns hiding unnecessary ones, or add columns with information helpful to evaluate the activity list.
- Re-sequence the column order and widths via drag ‘n drop in a way that is most visually convenient for your workers.
- Sort the list in the way that is most sensible to prioritize work appropriately.
- You may also need to reconsider whether to show only operations based on available quantity as per the default filter. Especially if you are not recording completions on all operations, some may never get a chance to appear unless you remove that filter.
- We highly recommend you set non-administrative users to have read-only authorization to any workbooks you create. Otherwise they are prone to change filters and columns in such a way that will be confusing to other users.

*Only available on Pro and Enterprise editions of Job Shop.

> See also[Adding and removing worksheets](#adding-and-removing-worksheets)[Altering columns](#altering-columns)[Managing workbooks](#managing-workbooks)[Searching and filtering](#searching-and-filtering)[Sharing changes](#workbooks-sharing-changes)[Sorting lists](#sorting)

## Operation completions

Operation completions are a transaction your shop floor workers or managers can record to report a quantity has been completed on a work order operation. This can help you monitor the progress of work done in your shop and can also potentially keep your inventory quantities updated in real time since operations that have products with the inventory setting issue method set to backflush associated with them are also backflushed in proportion with the quantity reported complete at the time of the transaction. This transaction will also automatically report quantities complete against all upstream operations so that it isn’t necessary to report against all of them.

*Shop floor staff can report progress on your work orders*

*Operation completion list with the first record in the list in the midst of posting*

The operation completion form has minimum requirements for quick entry. However, you can alternately report completions on a dispatch list where all that needs to be entered is the quantity.

Note when the last operation posts quantities complete, a work order receipt will automatically be created and posted.

- **Post** — This action records the transactions associated with a operation an completion as described above. Posting happens automatically when an operation completion is saved. However, if the posting should fail you can use this action to reattempt the posting. For example, a completion may fail to post if you have an active physical inventory count underway. In a case like this, you will have to post the completion after the count is complete.

*Operation completion form*

- **Number** — An automatically generated number. Operation completions begin with “OC-“.
- **Operation** — The work order operation that has been completed. Only active and in progress operations will be available to select.
- **Employee** — The employee that did the work. Defaults to the employee linked to the user account logged in.
- **Quantity** — The quantity to report complete.
- **Close operation** — Check this box if the operation is being closed with a quantity less than that planned, and there is no possibility of the original quantity being completed.

On the work order shown below the cut operation has been completed, and the assemble operation has been reported half complete. Note this example shows it is okay to report a partial quantity, which may make sense if there is a large effort involved to make one item, in which case partial completions can work like percentages.

*Work order operations with the first complete, the second partially complete and the third with no reporting*

*The work order timeline shows the first operation complete in dark green, and the second operation half complete.*

*Only available on Pro and Enterprise editions of Job Shop

> See also[Dispatch list](#dispatch-list)Work order receipt
