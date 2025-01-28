/*
    Framework for building object relational database apps
    Copyright (C) 2025  Featherbone LLC

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
/*jslint browser unordered*/
/*global f*/

/*
  Link Model
*/

function resourceLink(name, data, feather) {
    feather = feather || f.catalog().getFeather(name);
    let model = f.createModel(data, feather);
    let d = model.data;

    // Expression to extract a fileName portion of a URL,
    // considering hash and parameter
    // Based on: https://
    // stackoverflow.com/questions/14473180/regex-to-get-a-filename-from-a-url
    let urlExp = /[^/\\&\?#]+\.\w{3,4}(?=([\?&#].*$|$))/;
    let extExp = /\.(\w{3,4})/;
    let icoMap = {};
    let exts = ["jpg","jpeg","gif","png","bmp"];

    exts.forEach(function (i) {
        icoMap[i] = "image";
    });

    function extractFileName(url){
        let mat;
        if (url) {
            mat = url.match(urlExp);
            if (mat !== null){
                return mat[0];
            }
        }
        return null;
    }
    function mapIcon(ext){
        return icoMap[ext] || ext;
    }

    function suggestIcon(file){
        let low;
        let ext;
        let idx;

        if (file){
            ext = file.match(extExp);
            if (ext !== null){
                low = mapIcon(ext[1].toLowerCase());
                idx = f.icons().findIndex(function (v, i) {
                    if (v === low) {
                        return true;
                    }
                });
                if (idx >= 0) {
                    return low;
                }
            }
        }
        return null;
    }

    function handleLink() {
        let fileName;
        let ico;

        if (d.resource()) {
            fileName = extractFileName(d.resource());
            if (!d.label()){
                d.label(fileName);
            }
            if (!d.icon()){
                ico = suggestIcon(fileName);
                d.icon(ico);
            }
        }
        d.displayValue(d.label() || d.resource());
    }

    model.onChanged("icon", handleLink);
    model.onChanged("resource", handleLink);
    model.onChanged("label", handleLink);

    model.naturalKey = () => model.data.displayValue();
    model.canCopy = () => false;

    return model;
}

f.catalog().registerModel("ResourceLink", resourceLink.bind(null, "ResourceLink"));
f.catalog().registerModel("HelpLink", resourceLink.bind(null,"HelpLink"));
