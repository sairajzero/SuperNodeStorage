var db;
function setParameters(db){
    db = db
}

function processIncomingData(data) {
    return new Promise((resolve, reject) => {
        try {
            data = JSON.parse(data);
        } catch (error) {
            return reject("Data not in JSON-Format")
        }
        let curTime = Date.now()
        if (!data.time || data.time > curTime + floGlobals.supernodeConfig.delayDelta ||
            data.time < curTime - floGlobals.supernodeConfig.delayDelta)
            return reject("Invalid Time");
        else {
            let process;
            if (data.request) //Request
                process = processRequestFromUser(data.request);
            else if (data.message) //Store data
                process = processDataFromUser(data);
            //else if (data.edit)
            //    return processEditFromUser(gid, uid, data);
            else if (data) //Tag data
                process = processTagFromUser(gid, uid, data);
            //else if (data.delete)
            //    return processDeleteFromUser(gid, uid, data);
            else
                return reject("Invalid Data-format")
            process.then(result => resolve(result))
                .catch(error => reject(error))
        }

        /* if (floGlobals.supernodeConfig.errorFeedback)
                        floSupernode.supernodeClientWS.send(`@${uid}#${gid}:${error.toString()}`)
                        */
    })


}

function processDataFromUser(data) {
    return new Promise((resolve, reject) => {
        if (!floCrypto.validateAddr(data.receiverID))
            return reject("Invalid receiverID")
        let closeNode = floSupernode.kBucket.closestNode(data.receiverID)
        if (!floGlobals.serveList.includes(closeNode))
            return reject("Incorrect Supernode")
        if (!floCrypto.validateAddr(data.receiverID))
            return reject("Invalid senderID")
        if (data.senderID !== floCrypto.getFloID(data.pubKey))
            return reject("Invalid pubKey")
        let hashcontent = ["receiverID", "time", "application", "type", "message", "comment"]
            .map(d => data[d]).join("|")
        if (!floCrypto.verifySign(hashcontent, data.sign, data.pubKey))
            return reject("Invalid signature")

        db.addData(closeNode, {
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
            .catch(error => reject(error))
    })
}

function processRequestFromUser(request) {
    return new Promise((resolve, reject) => {
        if (!floCrypto.validateAddr(request.receiverID))
            return reject("Invalid receiverID");
        let closeNode = floSupernode.kBucket.closestNode(request.receiverID)
        if (!floGlobals.serveList.includes(closeNode))
            return reject("Incorrect Supernode");
        db.searchData(closeNode, request)
            .then(result => resolve([result]))
            .catch(error => reject(error))
    })
}

function processTagFromUser(data) {
    return new Promise((resolve, reject) => {
        if (!floCrypto.validateAddr(data.receiverID))
            return reject("Invalid receiverID")
        if (!(data.application in floGlobals.appList))
            return reject("Invalid application")
        if (!floCrypto.validateAddr(data.requestorID) ||
            !floGlobals.appSubAdmins.includes(data.requestorID))
            return reject("Invalid requestorID")
        if (data.requestorID !== floCrypto.getFloID(data.pubKey))
            return reject("Invalid pubKey")
        let closeNode = floSupernode.kBucket.closestNode(data.receiverID)
        if (!floGlobals.serveList.includes(closeNode))
            return reject("Incorrect Supernode")
        let hashcontent = ["time", "application", "tag"]
            .map(d => data[d]).join("|");
        if (!floCrypto.verifySign(hashcontent, data.sign, data.pubKey))
            return reject("Invalid signature");
        db.tagData(closeNode, data.vectorClock, data.tag, data.time, data.pubKey, data.sign)
            .then(result => resolve([result, 'TAG']))
            .catch(error => reject(error))
    })
}

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
    }
    return true;
}

module.exports = {
    setParameters,
    checkIfRequestSatisfy,
    processRequestFromUser,
    processIncomingData
}