const db = require("./database")

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
            if (data.request)
                process = processRequestFromUser(gid, uid, data);
            else if (data.message)
                process = processDataFromUser(gid, uid, data);
            //else if (data.edit)
            //    return processEditFromUser(gid, uid, data);
            else if (data.mark)
                process = processMarkFromUser(gid, uid, data);
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
            }).then(result => resolve(result))
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
            .then(result => resolve(result))
            .catch(error => reject(error))
    })
}