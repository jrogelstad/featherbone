/*
    A stand-in for a mail provider: a throwaway SMTP server that keeps
    what it is sent, so a test can read the mail the system sends and
    follow the link or the code in it. Used by admin-users.test.js and
    two-factor-mail.test.js.
*/
/*jslint node*/
"use strict";

const net = require("net");

function sink() {
    let mails = [];
    let server = net.createServer(function (socket) {
        let data = "";
        let body = false;

        function say(line) {
            socket.write(line + "\r\n");
        }

        say("220 sink ESMTP");
        socket.on("data", function (chunk) {
            data += chunk.toString("binary");

            while (data.length) {
                if (body) {
                    let end = data.indexOf("\r\n.\r\n");

                    if (end === -1) {
                        return;
                    }
                    /*
                        A line that starts with a dot is sent with a
                        second one, and a real server takes it off
                        again; a link token wrapped onto such a line
                        is otherwise corrupted.
                    */
                    mails[mails.length - 1].raw = data.slice(
                        0,
                        end
                    ).replace(/\r\n\.\./g, "\r\n.");
                    data = data.slice(end + 5);
                    body = false;
                    say("250 queued");
                } else {
                    let end = data.indexOf("\r\n");

                    if (end === -1) {
                        return;
                    }

                    let line = data.slice(0, end);

                    data = data.slice(end + 2);

                    if (/^EHLO/i.test(line)) {
                        socket.write(
                            "250-sink\r\n250-AUTH PLAIN LOGIN\r\n" +
                            "250 8BITMIME\r\n"
                        );
                    } else if (/^AUTH/i.test(line)) {
                        say("235 2.7.0 ok");
                    } else if (/^MAIL FROM/i.test(line)) {
                        mails.push({from: line, to: []});
                        say("250 ok");
                    } else if (/^RCPT TO/i.test(line)) {
                        mails[mails.length - 1].to.push(line);
                        say("250 ok");
                    } else if (/^DATA/i.test(line)) {
                        body = true;
                        say("354 go");
                    } else if (/^QUIT/i.test(line)) {
                        say("221 bye");
                        socket.end();
                    } else {
                        say("250 ok");
                    }
                }
            }
        });
        socket.on("error", () => undefined);
    });

    return new Promise(function (resolve) {
        server.listen(0, "127.0.0.1", function () {
            resolve({
                close: () => new Promise((done) => server.close(done)),
                mails,
                port: server.address().port
            });
        });
    });
}

// Quoted-printable back to text, so the link in the mail can be read
function decoded(raw) {
    return raw.replace(/=\r?\n/g, "").replace(
        /=([0-9A-F]{2})/g,
        (ignore, hex) => String.fromCharCode(parseInt(hex, 16))
    );
}

module.exports = {decoded, sink};
