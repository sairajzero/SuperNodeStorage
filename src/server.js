const http = require('http');
const WebSocket = require('ws');
const url = require('url');

const INVALID_E_CODE = 400,
    INTERNAL_E_CODE = 500;

module.exports = function Server(port, client, intra) {

    var refresher; //container for refresher

    const server = http.createServer((req, res) => {
        res.setHeader("Access-Control-Allow-Origin", "*");
        if (req.method === "GET") {
            //GET: requesting data
            let u = url.parse(req.url, true);
            if (!u.search)
                return res.end("");
            console.debug("GET:", u.search);
            client.processRequestFromUser(u.query)
                .then(result => res.end(JSON.stringify(result[0])))
                .catch(error => {
                    if (error instanceof INVALID)
                        res.writeHead(INVALID_E_CODE).end(error.message);
                    else {
                        console.error(error);
                        res.writeHead(INTERNAL_E_CODE).end("Unable to process request");
                    }
                });
        } else if (req.method === "POST") {
            //POST: All data processing (required JSON input)
            let data = '';
            req.on('data', chunk => data += chunk);
            req.on('end', () => {
                console.debug("POST:", data);
                //process the all data request types
                client.processIncomingData(data).then(result => {
                    res.end(JSON.stringify(result[0]));
                    if (result[1]) {
                        refresher.countdown;
                        if (['DATA', 'TAG', 'NOTE'].includes(result[1]))
                            sendToLiveRequests(result[0]);
                        intra.forwardToNextNode(result[2], result[0]);
                    };
                }).catch(error => {
                    if (error instanceof INVALID)
                        res.writeHead(INVALID_E_CODE).end(error.message);
                    else {
                        console.error(error);
                        res.writeHead(INTERNAL_E_CODE).end("Unable to process request");
                    }
                });
            });
        };
    });
    server.listen(port, (err) => {
        if (!err)
            console.log(`Server running at port ${port}`);
    });

    const wsServer = new WebSocket.Server({
        server
    });
    wsServer.on('connection', function connection(ws) {
        ws.onmessage = function(evt) {
            let message = evt.data;
            if (message.startsWith(intra.SUPERNODE_INDICATOR))
                intra.processTaskFromSupernode(message, ws);
            else {
                console.debug("WS: ", message);
                try {
                    var request = JSON.parse(message);
                    if (request.status !== undefined)
                        client.processStatusFromUser(request, ws);
                    else
                        client.processRequestFromUser(request).then(result => {
                            ws.send(JSON.stringify(result[0]));
                            ws._liveReq = request;
                        }).catch(error => {
                            if (floGlobals.sn_config.errorFeedback) {
                                if (error instanceof INVALID)
                                    ws.send(`${INVALID_E_CODE}: ${error.message}`);
                                else {
                                    console.error(error);
                                    ws.send(`${INTERNAL_E_CODE}: Unable to process request`);
                                }
                            }
                        });
                } catch (error) {
                    //console.error(error);
                    if (floGlobals.sn_config.errorFeedback)
                        ws.send(`${INVALID_E_CODE}: Request not in JSON format`);
                };
            };
        };
    });

    function sendToLiveRequests(data) {
        wsServer.clients.forEach(ws => {
            if (client.checkIfRequestSatisfy(ws._liveReq, data))
                ws.send(JSON.stringify(data));
        });
    };

    Object.defineProperty(this, "http", {
        get: () => server
    });
    Object.defineProperty(this, "webSocket", {
        get: () => wsServer
    });
    Object.defineProperty(this, "refresher", {
        set: (r) => refresher = r
    });
};