const http = require('http')
const WebSocket = require('ws')
const port = 8080;
const server = http.createServer((req, res) => {
    if (req.method === "GET") {
        //GET request (requesting data)
        req.on('end', () => {
            let i = req.url.indexOf("?");
            if (i) {
                var request = JSON.parse(req.url.substring(i));
                supernode.processRequestFromUser(request)
                    .then(result => res.end(JSON.parse(result[0])))
                    .catch(error => res.end(error))
            }
        })
    }
    if (req.method === "POST") {
        let data = '';
        req.on('data', chunk => data += chunk)
        req.on('end', () => {
            console.log(data);
            //process the data storing
            supernode.processIncomingData(data).then(result => {
                res.end(result[0]);
                if (result[1])
                    relayToBackupNodes(result[1]) //TODO
            }).catch(error => res.end(error))

        })
    }
});
server.listen(port, () => {
    console.log(`Server running at port ${port}`)
})

const wsServer = new WebSocket.Server({
    server
});
wsServer.on('connection', function connection(ws) {
    ws.on('message', message => {
        var request = JSON.parse(message)
        if (FROM_SUPERNODE)  //TODO
            backupProcess.processTaskFromSupernode(request, res => ws.send(res))
        else
            supernode.processRequestFromUser(request)
            .then(result => ws.send(JSON.parse(result[0])))
            .catch(error => ws.send(error))
    });
});