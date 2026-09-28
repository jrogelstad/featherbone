/*
    Module loader hook for unit tests.

    Featherbone's client code (.js files under client/) is written as ES
    modules but lives in a package without "type": "module", so Node would
    treat it as CommonJS. This hook tells Node to load those files as ES modules, the
    way the browser does with <script type="module">. Registered by
    browser-env.js through module.register().
*/
/*jslint node*/

const CLIENT = new URL("../../../client/", import.meta.url).href;

export async function load(url, context, nextLoad) {
    if (url.startsWith(CLIENT) && url.endsWith(".js")) {
        return nextLoad(url, Object.assign({}, context, {format: "module"}));
    }
    return nextLoad(url, context);
}
