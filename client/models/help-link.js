/*
    Framework for building object relational database apps
    Copyright (C) 2023  John Rogelstad

    This program is free software: you can redistribute it and/or modify
    it under the terms of the GNU Affero General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Affero General Public License for more details.

    You should have received a copy of the GNU Affero General Public License
    along with this program.  If not, see <http://www.gnu.org/licenses/>.
*/
/*jslint browser unordered devel*/
/*global f m*/

function helpLink(data, feather) {
    feather = feather || f.catalog().getFeather("HelpLink");
    let model = f.createModel(data, feather);

    return model;
}



helpLink.static = f.prop({
    upload: function (viewModel) {
        let input = document.createElement("input");
        let dialog = viewModel.confirmDialog();

        function error(err) {
            dialog.message(err.message);
            dialog.title("Error");
            dialog.icon("error");
            dialog.buttonCancel().hide();
            dialog.show();
        }

        async function processFile() {
            let file = input.files[0];
            let formData = new FormData();

            formData.append("package", file);

            let v = await f.datasource().request({
                method: "POST",
                path: "/do/upload",
                body: formData
            });

            if (v.status === "success") {
                let url = f.datasource() + "/files/upload/" + file.name;
                await m.request({
                    method: "POST",
                    url: "/data/resource-link",
                    body: {
                        "owner": f.currentUser().name,
                        "icon": "article",
                        "displayValue": file.name,
                        "label": file.name,
                        "resource": url
                    }
                });
            } else {
                error(new Error("Upload failed"));
            }
        }

        input.setAttribute("type", "file");
        input.setAttribute("accept", ".pdf");
        input.onchange = processFile;
        input.click();
    }
});

f.catalog().registerModel("HelpLink", helpLink);
