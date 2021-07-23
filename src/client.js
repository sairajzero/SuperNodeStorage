var DB, _list; //container for database and _list (stored n serving)

function processIncomingData(data) {
    return new Promise((resolve, reject) => {
        try {
            data = JSON.parse(data);
        } catch (error) {
            return reject("Data not in JSON-Format");
        };
        let curTime = Date.now();
        if (!data.time || data.time > curTime + floGlobals.sn_config.delayDelta ||
            data.time < curTime - floGlobals.sn_config.delayDelta)
            return reject("Invalid Time");
        else {
            let process;
            if (data.request) //Request
                process = processRequestFromUser(data.request);
            else if (data.message) //Store data
                process = processDataFromUser(data);
            else if (data) //Tag data
                process = processTagFromUser(data);
            /*
            else if (data.edit)
                return processEditFromUser(gid, uid, data);
            else if (data.delete)
                return processDeleteFromUser(gid, uid, data);
            */
            else
                return reject("Invalid Data-format");
            process.then(result => {
                console.log(result);
                resolve(result);
            }).catch(error => {
                console.error(error);
                reject(error);
            });
        };
    });
};

function processDataFromUser(data) {
    return new Promise((resolve, reject) => {
        if (!floCrypto.validateAddr(data.receiverID))
            return reject("Invalid receiverID");
        let closeNode = kBucket.closestNode(data.receiverID);
        if (!_list.serving.includes(closeNode))
            return reject("Incorrect Supernode");
        if (!floCrypto.validateAddr(data.receiverID))
            return reject("Invalid senderID");
        if (data.senderID !== floCrypto.getFloID(data.pubKey))
            return reject("Invalid pubKey");
        let hashcontent = ["receiverID", "time", "application", "type", "message", "comment"]
            .map(d => data[d]).join("|");
        if (!floCrypto.verifySign(hashcontent, data.sign, data.pubKey))
            return reject("Invalid signature");

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
            }).then(result => resolve([result, 'DATA']))
            .catch(error => reject(error));
    });
};

function processRequestFromUser(request) {
    return new Promise((resolve, reject) => {
        if (!floCrypto.validateAddr(request.receiverID))
            return reject("Invalid receiverID");
        let closeNode = kBucket.closestNode(request.receiverID);
        if (!_list.serving.includes(closeNode))
            return reject("Incorrect Supernode");
        DB.searchData(closeNode, request)
            .then(result => resolve([result]))
            .catch(error => reject(error));
    });
};

function processTagFromUser(data) {
    return new Promise((resolve, reject) => {
        if (!floCrypto.validateAddr(data.receiverID))
            return reject("Invalid receiverID");
        if (!(data.application in floGlobals.appList))
            return reject("Invalid application");
        if (!floCrypto.validateAddr(data.requestorID) ||
            !floGlobals.appSubAdmins.includes(data.requestorID))
            return reject("Invalid requestorID");
        if (data.requestorID !== floCrypto.getFloID(data.pubKey))
            return reject("Invalid pubKey");
        let closeNode = kBucket.closestNode(data.receiverID);
        if (!_list.serving.includes(closeNode))
            return reject("Incorrect Supernode");
        let hashcontent = ["time", "application", "tag"].map(d => data[d]).join("|");
        if (!floCrypto.verifySign(hashcontent, data.sign, data.pubKey))
            return reject("Invalid signature");
        let tag = ([null, undefined, ""].includes(data.tag) ? null : [data.tag].toString());
        DB.tagData(closeNode, data.vectorClock, tag, data.time, data.pubKey, data.sign)
            .then(result => resolve([result, 'TAG']))
            .catch(error => reject(error));
    });
};

function checkIfRequestSatisfy(request, data) {
    if (!request || request.mostRecent || request.receiverID !== data.receiverID)
        return false;
    if (request.atKey && request.atKey !== data.vectorClock)
        return false;
    if (request.lowerVectorClock && request.lowerVectorClock > data.vectorClock)
        return false;
    if (request.upperVectorClock && request.upperVectorClock < data.vectorClock)
        return false;
    if (request.application !== data.application)
        return false;
    if (request.comment && request.comment !== data.comment)
        return false;
    if (request.type && request.type !== data.type)
        return false;
    if (request.senderID) {
        if (Array.isArray(request.senderID) && !request.senderID.includes(data.senderID))
            return false;
        else if (request.senderID !== data.senderID)
            return false;
    };
    return true;
};

module.exports = {
    checkIfRequestSatisfy,
    processRequestFromUser,
    processIncomingData,
    set DB(db) {
        DB = db;
    },
    set _list(list) {
        _list = list;
    }
};