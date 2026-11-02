/*jslint unordered*/

const fs = f.Fs;
const pdfLib = () => f.PdfLib || missingLibrary();
const readFileSync = "readFileSync"; // Lint tyranny
const writeFileSync = "writeFileSync";
const dir = "./files/downloads/";

// Raised when a print is asked for and pdf-lib was not loaded, rather than
// when the server starts, so the rest of the module still loads
function missingLibrary() {
    throw (
        "The pdf-lib library is not loaded. Install the SupplyChain " +
        "package so it can install its libraries, or run npm install " +
        "pdf-lib in the Featherbone folder, then restart the server."
    );
}

// Joins the named PDF files, in the order given, into one. Every page keeps
// its own size, so paperSize, which used to set the size of an empty page
// that the joined pages then ignored, is no longer read.
async function print(obj) {
    let filename = obj.filename;
    let doc;
    let file;
    let pages;
    let src;
    let n = 0;

    if (!obj.data.sourceFiles) {
        throw "Files parameter must be passed";
    }

    if (!obj.data.sourceFiles.length) {
        return "";
    }

    doc = await pdfLib().PDFDocument.create();
    file = (filename || f.createId()) + ".pdf";

    // Load every source before writing anything so a bad file leaves
    // the others where they were
    while (n < obj.data.sourceFiles.length) {
        src = await pdfLib().PDFDocument.load(
            fs[readFileSync](dir + obj.data.sourceFiles[n])
        );
        n += 1;
        pages = await doc.copyPages(src, src.getPageIndices());
        pages.forEach((page) => doc.addPage(page));
    }

    fs[writeFileSync](dir + file, await doc.save());

    obj.data.sourceFiles.forEach(function (name) {
        fs.unlink(dir + name, () => true); // Clean up files
    });

    return file;
}

f.datasource.registerFunction(
    "POST",
    "doConsolidatePrint",
    print
);
