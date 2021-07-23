const http = require('http');
const WebSocket = require('ws');
const url = require('url');

module.exports = function Server(port, client, intra) {

    var refresher; //container for refresher

    const server = http.createServer((req, res) => {
        if (req.method === "GET") {
            //GET: requesting data
            let u = url.parse(req.url, true);
            if (!u.search)
                return res.end("");
            client.processRequestFromUser(u.query)
                .then(result => res.end(JSON.parse(result[0])))
                .catch(error => res.end(error.toString()));
        } else if (req.method === "POST") {
            //POST: All data processing (required JSON input)
            let data = '';
            req.on('data', chunk => data += chunk);
            req.on('end', () => {
                //process the data storing
                client.processIncomingData(data).then(result => {
                    res.end(result[0]);
                    if (result[1]) {
                        refresher.countdown;
                        if (result[1] === 'DATA')
                            sendToLiveRequests(result[0]);
                        intra.forwardToNextNode(result[1], result[0]);
                    };
                }).catch(error => res.end(error.toString()));
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
                var request = JSON.parse(message);
                client.processRequestFromUser(JSON.parse(message))
                    .then(result => {
                        ws.send(JSON.parse(result[0]));
                        ws._liveReq = request;
                    }).catch(error => {
                        if (floGlobals.sn_config.errorFeedback)
                            ws.send(error.toString());
                    });
            };
        };
    });

    function sendToLiveRequests(data) {
        wsServer.clients.forEach(ws => {
            if (client.checkIfRequestSatisfy(ws._liveReq, data))
                ws.send(data);
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