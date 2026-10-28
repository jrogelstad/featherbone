/*jslint devel browser unordered*/
/*global printJS*/
/* Module for tracking development progress*/
const catalog = f.catalog();
const success = catalog.register("functions").success;
const error = catalog.register("functions").error;

function taskLabel(td) {
    let ary = [];

    if (td.wbs()) {
        ary.push(td.wbs());
    }

    if (td.description()) {
        ary.push(td.description());
    }
    return ary.join(" - ");
}

function updateGantt(model) {
    let d = model.data;
    let startDate;
    let endDate;
    let plan;

    function createTask(task) {
        let td = task.data;
        let taskStart;
        let taskEnd;
        let typ;
        let formatLinks = td.links().filter(function (link) {
            return link.state().current()[0] !== "/Delete";
        }).map(function (link) {
            return {target: link.data.task(), type: link.data.type()};
        });

        if (td.plannedStartDate()) {
            taskStart = f.parseDate(td.plannedStartDate());
        }
        if (td.plannedEndDate()) {
            taskEnd = f.parseDate(td.plannedEndDate());
        }
        if (td.plannedStartDate() === td.plannedEndDate()) {
            typ = "milestone";
        }
        if (d.tasks().some((t) => t.data.parent() === td.linkId())) {
            typ = "group";
        }
        plan.data.push({
            id: task.data.linkId(),
            type: typ,
            parent: model.id(),
            text: taskLabel(td),
            start: taskStart,
            end: taskEnd,
            percent: td.percentComplete().times(0.01),
            links: formatLinks
        });
    }

    if (d.plannedStartDate()) {
        startDate = f.parseDate(d.plannedStartDate());
    }
    if (d.plannedEndDate()) {
        endDate = f.parseDate(d.plannedEndDate());
    }
    plan = {data: [{
        id: model.id(),
        type: "group",
        text: d.description(),
        start: startDate,
        end: endDate,
        percent: d.percentComplete().times(0.01),
        links: []
    }]};

    d.tasks().forEach(createTask);
    d.gantt(plan);
}

/*
    Project model
*/
function project(data, feather) {
    feather = feather || catalog.getFeather("Project");
    let model = f.createModel(data, feather);
    let updGantt = updateGantt.bind(null, model);

    model.onChanged("description", updGantt);
    model.onChanged("plannedStartDate", updGantt);
    model.onChanged("plannedEndDate", updGantt);
    model.onChanged("percentComplete", updGantt);
    model.onChanged("tasks", updGantt);
    model.onChanged("tasks.wbs", updGantt);
    model.onChanged("tasks.description", updGantt);
    model.onChanged("tasks.percentComplete", updGantt);
    model.onChanged("tasks.plannedStartDate", updGantt);
    model.onChanged("tasks.plannedEndDate", updGantt);
    model.onChanged("tasks.parent", updGantt);
    model.onChanged("percentComplete", updGantt);
    model.onChanged("percentComplete", function (p) {
        model.data.isClosed(p() >= 100);
    });

    return model;
}

catalog.registerModel("Project", project);

function printPdf(doc) {
    let url = (
        window.location.protocol + "//" +
        window.location.hostname + ":" +
        window.location.port + "/pdf/" + doc
    );
    printJS(url);
}

function doPrint(viewModel, type, url) {
    url = url || "/do/print-pdf/form/";
    let dialog = viewModel.confirmDialog();
    let models = viewModel.selections();
    let settings = catalog.store().models()[type + "Settings"]();
    let form = settings.data[type + "Form"]();
    let payload;

    if (!form) {
        error(dialog, {message: (
            "Form name for " + type + " form " +
            "must be defined in settings."
        )});
        return;
    }

    payload = {
        method: "POST",
        path: url,
        body: {
            ids: models.map((i) => i.id()),
            form: form.data.name()
        }
    };

    f.datasource().request(
        payload
    ).then(
        printPdf
    ).catch(function (resp) {
        error(dialog, resp);
    });
}

project.static().print = function (viewModel) {
    doPrint(viewModel, "project");
};

project.static().checkPrint = (sel) => sel.length;

function taskList(prttsk) {
    let prtprj;
    let list = [];

    if (prttsk) {
        prtprj = prttsk.parent();
        if (prtprj) {
            list = prtprj.data.tasks().filter(function (tsk) {
                if (
                    tsk.data.linkId() !== prttsk.data.linkId() &&
                    tsk.state().current()[0] !== "/Delete"
                ) {
                    return true;
                }
                return false;
            }).map(function (tsk) {
                return {
                    label: taskLabel(tsk.data),
                    value: tsk.data.linkId()
                };
            });
        }
        return list;
    }
}

/*
    Project Task model
*/
function pt(data, feather) {
    feather = feather || catalog.getFeather("ProjectTask");
    let model = f.createModel(data, feather);

    function updGantt() {
        return updateGantt(model.parent());
    }

    model.onChanged("links", updGantt);
    model.onChanged("links.task", updGantt);
    model.onChanged("links.type", updGantt);
    model.onChanged("percentComplete", function (p) {
        model.data.isClosed(p() >= 100);
    });

    model.addCalculated({
        name: "taskList",
        function: taskList.bind(null, model)
    });

    return model;
}

catalog.registerModel("ProjectTask", pt);

/*
    Project Task Link model
*/
function ptl(data, feather) {
    feather = feather || catalog.getFeather("ProjectTaskLink");
    let model = f.createModel(data, feather);

    model.addCalculated({
        name: "taskList",
        function: () => taskList(model.parent())
    });

    return model;
}

catalog.registerModel("ProjectTaskLink", ptl);

/*
    Task model
*/
function task(data, feather) {
    feather = feather || catalog.getFeather("Task");
    let model = f.createModel(data, feather);
    let d = model.data;

    function handleColor() {
        switch (Number(d.priority())) {
        case 1:
            model.style("BUG-SHOWSTOPPER");
            break;
        case 2:
            model.style("BUG-HIGH");
            break;
        case 3:
            model.style("");
            break;
        case 4:
            model.style("BUG-LOW");
            break;
        }
    }
    model.onChanged("priority", handleColor);
    model.onLoad(handleColor);

    return model;
}

catalog.registerModel("Task", task);

