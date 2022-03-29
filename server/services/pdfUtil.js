(function(exports){
    "use strict";
    const fs = require("fs");
    const { PDFDocument } = require("pdf-lib");
    const {createCanvas,loadImage} = require("canvas");
    const defTextLabel = "Confidential";

    let fonts = {
        Courier: require("pdfjs/font/Courier"),
        CourierBold: require("pdfjs/font/Courier-Bold"),
        CourierBoldOblique: require("pdfjs/font/Courier-BoldOblique"),
        CourierOblique: require("pdfjs/font/Courier-Oblique"),
        Helvetica: require("pdfjs/font/Helvetica"),
        HelveticaBold: require("pdfjs/font/Helvetica-Bold"),
        HelveticaBoldOblique: require("pdfjs/font/Helvetica-BoldOblique"),
        HelveticaOblique: require("pdfjs/font/Helvetica-Oblique"),
        Times: require("pdfjs/font/Times-Roman"),
        TimesBold: require("pdfjs/font/Times-Bold"),
        TimesBoldItalic: require("pdfjs/font/Times-BoldItalic"),
        TimesItalic: require("pdfjs/font/Times-Italic")
    };

    function setHypWidth(cfg){
        cfg.hypWidth = parseInt(
            Math.sqrt(
                (cfg.width * cfg.width)
                + (cfg.height * cfg.height)
            )
        );
    }

    function newPdfConfig(){
        let cfg = {
            adoptPageDimensions: false,
            width: 595.296,
            height: 841.896,
            textAlign: "center",
            fillText: false,
            strokeText: true,
            fontColor: "#CFCFCF",
            fontStroke: "#000000",
            fontFamily: "Arial",
            fontStyle: "bold",
            fontSize: 98,
            maxTextPercent: 0.8,
            imageScale: 0.8,
            transparency: 0.25,
            canvasExportType: "image/png",
            leftAdjustment: 0.15,
            topAdjustment: 0.9,
            debugOutput: false
        };
        cfg.textLabel = defTextLabel;
        setHypWidth(cfg);
        return cfg;
    }

    function computeFontSizeToWidth(cfg, ctx){
        let start = Date.now();
        let useFontSize = cfg.fontSize;
        ctx.font = cfg.fontStyle
            + " " + parseInt(useFontSize)
            + "pt \"" + cfg.fontFamily + "\""
        ;

        let txtWidth = ctx.measureText(cfg.textLabel).width;
        let txtRatio = (txtWidth / cfg.hypWidth);

        while(txtRatio < cfg.maxTextPercent){
            useFontSize += 1;
            ctx.font = cfg.fontStyle
                + " " + parseInt(useFontSize)
                + "pt \"" + cfg.fontFamily + "\""
            ;
            txtWidth = ctx.measureText(cfg.textLabel).width;
            txtRatio = (txtWidth / cfg.hypWidth);
        }
        return useFontSize;
    }

    function radians(degrees){
        return (degrees * Math.PI / 180);
    }
    function degrees(radians) {
        return (radians / Math.PI * 180);
    }
    function applyCosine(a, b, c) {
        let angle = (
            Math.pow(a, 2) + Math.pow(b, 2) - Math.pow(c, 2)
        ) / (2 * a * b);
        if (angle >= -1 && angle <= 0.99) {
            return degrees(Math.acos(angle));
        }
        else {
            return 0;
        }
    }

    function waterMark(cfg){
        return new Promise(function (res,rej) {
            let cvs = createCanvas(cfg.width, cfg.height);
            let ctx = cvs.getContext("2d");

            let useFontSize = computeFontSizeToWidth(cfg, ctx);
            let triangle = {
                    A : Math.round(
                        applyCosine(cfg.height, cfg.hypWidth, cfg.width)
                    ),
                    B : Math.round(
                        applyCosine(cfg.hypWidth, cfg.width, cfg.height)
                    ),
                    C : Math.round(
                        applyCosine(cfg.width, cfg.height, cfg.hypWidth)
                    )
            };
            let angle = triangle.B;

            ctx.textAlign = cfg.textAlign;
            ctx.fillStyle = cfg.fontColor;
            ctx.strokeStyle = cfg.fontStroke;
            ctx.font = cfg.fontStyle
                + " " + parseInt(useFontSize)
                + "pt \"" + cfg.fontFamily + "\""
            ;
            let metric = ctx.measureText(cfg.textLabel);
            let textWidth = metric.width;
            let textHeight =  metric.actualBoundingBoxAscent
                + metric.actualBoundingBoxDescent
            ;

            let left = (cfg.width * cfg.leftAdjustment);
            let top = (cfg.height * cfg.topAdjustment);
            ctx.save();
            ctx.translate(left, top + textHeight / 2);
            ctx.rotate(radians(-1 * angle));
            ctx.globalAlpha = cfg.transparency;
            if (cfg.strokeText) {
                ctx.strokeText(cfg.textLabel, textWidth/2, 0);
            }
            if (cfg.fillText) {
                ctx.fillText(cfg.textLabel, textWidth/2, 0);
            }
            if (!cfg.debugOutput) {
                res(cvs);
            }
            else {
                let buff = cvs.toBuffer(cfg.canvasExportType);
                fs.writeFile("./debug.png", buff, function (err) {
                    if (err) {
                        console.error(err);
                    }
                    else {
                        res(cvs);
                    }
                });
            }
        });
    }

    async function waterMarkPage (cfg, pdfDoc, page, cvs) {
        let w = page.getWidth();
        let h = page.getHeight();
        if(!cvs || (
            cfg.adoptPageDimensions && (w !== cfg.width || h !== cfg.height)
        )){
            cfg.width = w;
            cfg.height = h;
            setHypWidth(cfg);
            cvs = await waterMark(cfg);
        }

        let arrayBuff = cvs.toBuffer(cfg.canvasExportType);
        let pngBuff = Buffer.alloc(arrayBuff.length);
        pngBuff.fill(new Uint8Array(arrayBuff));
        const pngImage = await pdfDoc.embedPng(pngBuff);

        /// There is a margin on the image
        /// It is currently scaled down by 20% and on the x-axis
        ///
        const pngDims = pngImage.scale(cfg.imageScale);

        let px = 0;
        let py = page.getHeight() - (page.getHeight() * cfg.maxTextPercent);
        page.drawImage(pngImage, {
            x: px,
            y: py,
            width: pngDims.width,
            height: pngDims.height
          });
    }
    async function savePdf(path, bytes){
        return new Promise(function (res, rej) {
            fs.writeFile(path, bytes, function(err){
                res(err);
            });
        });
    }
    async function waterMarkPdf(bytes, label, outPath, options){
        let cfg = newPdfConfig();
        cfg.textLabel = label || defTextLabel;
        if(options){
            if(options.width && options.height){
                cfg.width = options.width;
                cfg.height = options.height;
                setHypWidth(cfg);
            }

            if(options.minimumSize){
                cfg.fontSize = options.minimumSize;
            }
            if(options.leftAdjustment){
                cfg.leftAdjustment = options.leftAdjustment;
            }
            if(options.topAdjustment){
                cfg.topAdjustment = options.topAdjustment;
            }
            if(typeof options.opacity === "number"){
                cfg.transparency = options.opacity;
            }
            if(typeof options.strokeText === "boolean"){
                cfg.strokeText = options.strokeText;
            }
            if(typeof options.fillText === "boolean"){
                cfg.fillText = options.fillText;
            }
            if(options.fillColor){
                cfg.fontColor = options.fillColor;
            }
            if(options.strokeColor){
                cfg.fontStroke = options.strokeColor;
            }
            if(options.fontFamily){
                cfg.fontFamily = options.fontFamily;
            }
        }
        if(!options || !(
            options.width && options.height
        )) {
            cfg.adoptPageDimensions = true;
        }

        let cvs;
        if(!cfg.adoptPageDimensions) {
            cvs = await waterMark(cfg);
        }
        if(typeof bytes === "string"){
            bytes = fs.readFileSync(bytes);
        }
        let pdfDoc = await PDFDocument.load(bytes);

        let pages = pdfDoc.getPages();
        let i;
        for (i = 0; i < pages.length; i += 1) {
            await waterMarkPage(cfg, pdfDoc, pages[i], cvs);
        };

        let outBytes = await pdfDoc.save();
        if(outPath) {
            await savePdf(outPath, outBytes);
        }
        return outBytes;
    }
    exports.PDFUtil = {
        waterMark : waterMarkPdf
    };

}(exports));
