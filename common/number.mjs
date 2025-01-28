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
/*jslint this, node */
import Big from "../node_modules/big.js/big.mjs";

Number.prototype.pad = function (width, str) {
    let n = String(this);
    let a = [];
    str = str || "0";
    if (n.length < width) {
        a.length = width - n.length + 1;
    }

    return (
        a.length
        ? a.join(str) + n
        : n
    );
};

Number.prototype.div = function (n) {
    return new Big(this).div(n).valueOf() - 0;
};

Number.prototype.minus = function (n) {
    return new Big(this).minus(n).valueOf() - 0;
};

Number.prototype.plus = function (n) {
    return new Big(this).plus(n).valueOf() - 0;
};

Number.prototype.times = function (n) {
    return new Big(this).times(n).valueOf() - 0;
};

Number.prototype.round = function (dp) {
    return new Big(this).round(dp).valueOf() - 0;
};
