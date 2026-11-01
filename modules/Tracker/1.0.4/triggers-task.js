function doUpdateTask(obj) {
    return new Promise(function (resolve) {
        if (obj.oldRec.comments !== obj.newRec.comments) {
            obj.newRec.history.push({
                text: obj.newRec.comments
            });
        }
        resolve();
    });
}

f.datasource.registerFunction(
    "PATCH",
    "Task",
    doUpdateTask,
    f.datasource.TRIGGER_BEFORE
);