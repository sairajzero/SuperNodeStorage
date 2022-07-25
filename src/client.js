var DB, _list; //container for database and _list (stored n serving)

global.INVALID = function(message) {
    if (!(this instanceof INVALID))
        return new INVALID(message);
    this.message = message;
}

function processIncomingData(data) {
    return new Promise((resolve, reject) => {
        try {
            data = JSON.parse(data);
        } catch (error) {
            return reject(INVALID("Data not in JSON-Format"));
        };
        let curTime = Date.now();
        if (!data.time || data.time > curTime + floGlobals.sn_config.delayDelta ||
            data.time < curTime - floGlobals.sn_config.delayDelta)
            return reject(INVALID("Invalid Time"));
        else {
            let process;
            if ('request' in data) //Request
                process = processRequestFromUser(data.request);
            else if ('message' in data) //Store data
                process = processDataFromUser(data);
            else if ('tag' in data) //Tag data
                process = processTagFromUser(data);
            else if ('note' in data)
                process = processNoteFromUser(data);
            /*
            else if (data.edit)
                return processEditFromUser(gid, uid, data);
            else if (data.delete)
                return processDeleteFromUser(gid, uid, data);
            */
            else
                return reject(INVALID("Invalid Data-format"));
            process.then(result => {
                console.debug(result);
                resolve(result);
            }).catch(error => {
                console.debug(error);
                reject(error);
            });
        };
    });
};

function processDataFromUser(data) {
    return new Promise((resolve, reject) => {
        if (!floCrypto.validateFloID(data.receiverID))
            return reject(INVALID("Invalid receiverID"));
        let closeNode = cloud.closestNode(data.receiverID);
        if (!_list.serving.includes(closeNode))
            return reject(INVALID("Incorrect Supernode"));
        if (!floCrypto.validateFloID(data.senderID))
            return reject(INVALID("Invalid senderID"));
        if (data.senderID !== floCrypto.getFloID(data.pubKey))
            return reject(INVALID("Invalid pubKey"));
        let hashcontent = ["receiverID", "time", "application", "type", "message", "comment"]
            .map(d => data[d]).join("|");
        if (!floCrypto.verifySign(hashcontent, data.sign, data.pubKey))
            return reject(INVALID("Invalid signature"));

        DB.addData(closeNode, {
            vectorClock: `${Date.now()}_${data.senderID}`,
            senderID: data.senderID,
            receiverID: data.receiverID,
            time: data.time,
            application: data.application,
            type: data.type,
            message: data.message,
            comment: data.comment,
            sign: data.sign,
            pubKey: data.pubKey
        }).then(rb => {
            DB.getData(closeNode, rb.vectorClock)
                .then(result => resolve([result[0], 'DATA', rb]))
                .catch(error => reject(error))
        }).catch(error => reject(error));
    });
};

function processRequestFromUser(request) {
    return new Promise((resolve, reject) => {
        if (!floCrypto.validateFloID(request.receiverID))
            return reject(INVALID("Invalid receiverID"));
        let closeNode = cloud.closestNode(request.receiverID);
        if (!_list.serving.includes(closeNode))
            return reject(INVALID("Incorrect Supernode"));
        DB.searchData(closeNode, request)
            .then(result => resolve([result]))
            .catch(error => reject(error));
    });
};

function processTagFromUser(data) {
    return new Promise((resolve, reject) => {
        if (!floCrypto.validateFloID(data.receiverID))
            return reject(INVALID("Invalid receiverID"));
        let closeNode = cloud.closestNode(data.receiverID);
        if (!_list.serving.includes(closeNode))
            return reject(INVALID("Incorrect Supernode"));
        DB.getData(closeNode, data.vectorClock).then(result => {
            if (!result.length)
                return reject(INVALID("Invalid vectorClock"));
            result = result[0];
            if (!(result.application in floGlobals.appList))
                return reject(INVALID("Application not authorised"));
            if (!floCrypto.validateFloID(data.requestorID) ||
                !floGlobals.appSubAdmins[result.application].includes(data.requestorID))
                return reject(INVALID("Invalid requestorID"));
            if (data.requestorID !== floCrypto.getFloID(data.pubKey))
                return reject(INVALID("Invalid pubKey"));
            let hashcontent = ["time", "vectorClock", "tag"].map(d => data[d]).join("|");
            if (!floCrypto.verifySign(hashcontent, data.sign, data.pubKey))
                return reject(INVALID("Invalid signature"));
            let tag = ([null, undefined, ""].includes(data.tag) ? null : data.tag.toString());
            DB.tagData(closeNode, data.vectorClock, tag, data.time, data.pubKey, data.sign).then(rb => {
                DB.getData(closeNode, data.vectorClock)
                    .then(result => resolve([result[0], 'TAG', rb]))
                    .catch(error => reject(error))
            }).catch(error => reject(error))
        }).catch(error => reject(error))
    });
};

function processNoteFromUser(data) {
    return new Promise((resolve, reject) => {
        if (!floCrypto.validateFloID(data.receiverID))
            return reject(INVALID("Invalid receiverID"));
        let closeNode = cloud.closestNode(data.receiverID);
        if (!_list.serving.includes(closeNode))
            return reject(INVALID("Incorrect Supernode"));
        DB.getData(closeNode, data.vectorClock).then(result => {
            if (!result.length)
                return reject(INVALID("Invalid vectorClock"));
            result = result[0];
            if (result.application in floGlobals.appList && floGlobals.appList[result.application] === result.receiverID) {
                if (!floGlobals.appSubAdmins[result.application].includes(data.requestorID) && result.receiverID !== data.requestorID)
                    return reject(INVALID("Invalid requestorID"));
            } else if (result.receiverID !== data.requestorID)
                return reject(INVALID("Invalid requestorID"));
            if (data.requestorID !== floCrypto.getFloID(data.pubKey))
                return reject(INVALID("Invalid pubKey"));
            let hashcontent = ["time", "vectorClock", "note"].map(d => data[d]).join("|");
            if (!floCrypto.verifySign(hashcontent, data.sign, data.pubKey))
                return reject(INVALID("Invalid signature"));
            let note = ([null, undefined, ""].includes(data.note) ? null : data.note.toString());
            DB.noteData(closeNode, data.vectorClock, note, data.time, data.pubKey, data.sign).then(rb => {
                DB.getData(closeNode, data.vectorClock)
                    .then(result => resolve([result[0], 'NOTE', rb]))
                    .catch(error => reject(error))
            }).catch(error => reject(error))
        }).catch(error => reject(error))
    })
}

function checkIfRequestSatisfy(request, data) {
    if (!request || request.mostRecent || request.receiverID !== data.receiverID)
        return false;
    if (request.atVectorClock && request.atVectorClock !== data.vectorClock)
        return false;
    if (request.lowerVectorClock && request.lowerVectorClock > data.vectorClock)
        return false;
    if (request.upperVectorClock && request.upperVectorClock < data.vectorClock)
        return false;
    if (request.afterTime && request.afterTime > data.log_time)
        return false;
    if (request.application !== data.application)
        return false;
    if (request.comment && request.comment !== data.comment)
        return false;
    if (request.type && request.type !== data.type)
        return false;
    if (request.senderID) {
        if (Array.isArray(request.senderID)) {
            if (!request.senderID.includes(data.senderID))
                return false;
        } else if (request.senderID !== data.senderID)
            return false;
    };
    return true;
};

function processStatusFromUser(request, ws) {
    if (request.status) {
        //Set user-online status
        if (!request.floID || !request.application || !request.sign || !request.pubKey || !request.time)
            return ws.send("Invalid request parameters");
        if (request.floID !== floCrypto.getFloID(request.pubKey))
            return ws.send("Invalid pubKey");
        let hashcontent = ["time", "application", "floID"].map(d => request[d]).join("|");
        if (!floCrypto.verifySign(hashcontent, request.sign, request.pubKey))
            return ws.send("Invalid signature");
        clientOnline(ws, request.application, request.floID);
    } else {
        //Track online status
        if (!request.application || !Array.isArray(request.trackList))
            return ws.send("Invalid request parameters");
        addRequestClient(ws, request.application, request.trackList);
    }
}

let onlineClients = {},
    requestClients = {};

const ONLINE = 1,
    OFFLINE = 0;

function clientOnline(ws, application, floID) {
    if (!(application in onlineClients))
        onlineClients[application] = {};
    if (floID in onlineClients[application])
        onlineClients[application][floID] += 1;
    else {
        onlineClients[application][floID] = 1;
        informRequestClients(application, floID, ONLINE);
    }
    ws.on('close', () => clientOffline(application, floID));
}

function clientOffline(application, floID) {
    if (application in onlineClients)
        if (floID in onlineClients[application]) {
            if (onlineClients[application][floID] > 1)
                onlineClients[application][floID] -= 1;
            else {
                delete onlineClients[application][floID];
                informRequestClients(application, floID, OFFLINE);
                if (!Object.keys(onlineClients[application]).length)
                    delete onlineClients[application];
            }
        }
}

function addRequestClient(ws, application, trackList) {
    let id = Date.now() + floCrypto.randString(8);
    if (!(application in requestClients))
        requestClients[application] = {};
    requestClients[application][id] = {
        ws: ws,
        trackList
    };
    let status = {};
    if (application in onlineClients)
        trackList.forEach(floID => status[floID] = (onlineClients[application][floID] ? ONLINE : OFFLINE));
    else
        trackList.forEach(floID => status[floID] = OFFLINE);
    ws.send(JSON.stringify(status));
    ws.on('close', () => rmRequestClient(application, id));
}

function rmRequestClient(application, id) {
    if ((application in requestClients) && (id in requestClients[application])) {
        delete requestClients[application][id];
        if (!Object.keys(requestClients[application]).length)
            delete requestClients[application];
    }
}

function informRequestClients(application, floID, status) {
    if (application in requestClients)
        for (let r in requestClients[application])
            if (requestClients[application][r].trackList.includes(floID))
                requestClients[application][r].ws.send(JSON.stringify({
                    [floID]: status
                }));
}

module.exports = {
    checkIfRequestSatisfy,
    processRequestFromUser,
    processIncomingData,
    processStatusFromUser,
    set DB(db) {
        DB = db;
    },
    set _list(list) {
        _list = list;
    }
};