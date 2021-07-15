'use strict';
const WebSocket = require('ws');

//CONSTANTS
const SUPERNODE_INDICATOR = '$',
    //Message type
    ORDER_BACKUP = "orderBackup",
    START_BACKUP_SERVE = "startBackupServe",
    STOP_BACKUP_SERVE = "stopBackupServe",
    START_BACKUP_STORE = "startBackupStore",
    STOP_BACKUP_STORE = "stopBackupStore",
    STORE_BACKUP_DATA = "backupData",
    STORE_MIGRATED_DATA = "migratedData",
    DELETE_BACKUP_DATA = "backupDelete",
    TAG_BACKUP_DATA = "backupTag",
    EDIT_BACKUP_DATA = "backupEdit",
    NODE_ONLINE = "supernodeUp",
    INITIATE_REFRESH = "initiateRefresh",
    DATA_REQUEST = "dataRequest",
    DATA_SYNC = "dataSync",
    BACKUP_HANDSHAKE_INIT = "handshakeInitate",
    BACKUP_HANDSHAKE_END = "handshakeEnd";

/*Supernode Backup and migration functions*/
//const backupNodes = [];
var backupDepth, supernodeList, appList, kBucket;

const _list = {};
Object.defineProperty(_list, 'delete', {
    value: function(id) {
        delete this[id];
    }
});
Object.defineProperty(_list, 'get', {
    value: function(keys = null) {
        if (keys === null) keys = Object.keys(this);
        if (Array.isArray(keys))
            return Object.fromEntries(keys.map(k => [k, this[k]]));
        else
            return this[keys];
    }
})
Object.defineProperty(_list, 'stored', {
    get: function() {
        return Object.keys(this);
    }
});
Object.defineProperty(_list, 'serving', {
    get: function() {
        let serveList = []
        for (let id in this)
            if (this[id] === 0)
                serveList.push(id);
        return serveList;
    }
});

const _nextNode = {};
Object.defineProperty(_nextNode, 'set', {
    value: function(id, ws) {
        this.id = id;
        this.ws = ws;
    }
})
Object.defineProperty(_nextNode, 'send', {
    value: function(packet) {
        this.ws.send(packet);
    }
});

const _prevNode = {};
Object.defineProperty(_prevNode, 'set', {
    value: function(id, ws) {
        this.id = id;
        this.ws = ws;
    }
})
Object.defineProperty(_prevNode, 'send', {
    value: function(packet) {
        this.ws.send(packet);
    }
});

const packet_ = {}
packet_.constuct = function(message) {
    const packet = {
        from: myFloID,
        message: message,
        time: Date.now()
    }
    packet.sign = floCrypto.signData(this.s(packet), myPrivKey);
    return SUPERNODE_INDICATOR + JSON.stringify(packet)
}
packet_.s = d => [JSON.stringify(d.message), d.time].join("|");
packet_.parse = function(str) {
    let packet = JSON.parse(str.substring(SUPERNODE_INDICATOR.length))
    let curTime = Date.now();
    if (packet.time > curTime - delayTime &&
        floCrypto.verifySign(this.s(packet), packet.sign, supernodeList[packet.from].pubKey)) {
        if (!Array.isArray(packet.message))
            packet.message = [packet.message];
        return packet;
    }
}

function setBlockchainParameters(depth, supernodes, apps, KB, delay) {
    backupDepth = depth;
    supernodeList = supernodes;
    appList = apps;
    kBucket = KB;
    delayTime = delay;
}

function connectToNextNode(nodeID = myFloID) {
    return new Promise((resolve, reject) => {
        let nextNodeID = kBucket.nextNode(nodeID);

        const ws = new WebSocket("wss://" + supernodeList[nextNodeID].uri + "/");
        ws.on("error", () => {
            connectToNextNode(nextNodeID)
                .then(result => resolve(result))
                .catch(error => reject(error))
        });

        ws.on('open', function open() {
            _nextNode.set(nextNodeID, ws)
            ws.send(packet_.constuct({
                type: BACKUP_HANDSHAKE_INIT
            }));
            resolve("BACKUP_HANDSHAKE_INIT: " + nextNodeID)
        });

        ws.on('message', function incoming(packet) {
            processTaskFromNextNode(packet)
        });
    })
}

function handshakeMid(id, ws) {
    if (_prevNode.id) {
        if (kBucket.innerNodes(_prevNode.id, myFloID).includes(id)) {
            //close existing prev-node connection
            _prevNode.send(packet_.constuct({
                type: RECONNECT_NEXT_NODE
            }));
            _prevNode.close();
            //set the new prev-node connection
            _prevNode.set(id, ws);
            _prevNode.send(packet_.constuct({
                type: BACKUP_HANDSHAKE_END
            }))
        } else {
            //Incorrect order, existing prev-node is already after the incoming node
            ws.send(packet_.constuct({
                type: RECONNECT_NEXT_NODE
            }))
            return;
        }
    } else {
        //set the new prev-node connection
        _prevNode.set(id, ws);
        _prevNode.send(packet_.constuct({
            type: BACKUP_HANDSHAKE_END
        }))
    }
    //Reorder storelist
    let nodes = kBucket.innerNodes(_prevNode.id, myFloID).concat(myFloID),
        req_sync = [],
        new_order = [];
    nodes.forEach(n => {
        switch (_list[n]) {
            case 0: //Do nothing
                break;
            case undefined:
                req_sync.push(n);
            default:
                _list[n] = 0;
                new_order.push(n);
        }
    });
    if (!req_sync.length && !new_order.length)
        return; //No order change and no need for any data sync
    Promise.all(req_sync.forEach(n => db.createGetLastLog(n))).then(result => {
        let tasks = [];
        if (req_sync.length) {
            tasks.push({
                type: DATA_REQUEST,
                nodes: Object.fromEntries(req_sync.map((k, i) => [k, result[i]]))
            })
        }
        if (new_order.length) {
            tasks.push({
                type: ORDER_BACKUP,
                order: _list.get(new_order)
            })
        }
        _nextNode.send(packet_.constuct(tasks));
    }).catch(error => {
        FATAL.RECONNECTION_REQUIRED //TODO
    })
}

function handshakeEnd() {
    console.log("Backup connected: " + _nextNode.id)
    _nextNode.send(packet_.constuct({
        type: ORDER_BACKUP,
        order: _list.get()
    }))
}

function reconnectNextNode() {
    connectToNextNode()
        .then(result => console.log(result))
        .catch(error => console.error(error))
}

function orderBackup(order) {
    let new_order = [];
    for (let n in order) {
        if (order[n] + 1 !== _list[n]) {
            if (order[n] >= backupDepth)
                REMOVE_STORING_if_exist(N) //TODO
            else if (condition) { //TODO: condition to check roll over when less nodes online 
                _list[n] = order[n] + 1;
                new_order.push(n);
            }
        }
    }
    if (new_order.length) {
        _nextNode.send(packet_.constuct({
            type: ORDER_BACKUP,
            order: _list.get(new_order)
        }));
    }
}

function storeBackupData(data) {
    let closestNode = kBucket.closestNode(data.receiverID);
    if (_list.stored.includes(closestNode))
        db.storeData(closestNode, data);
}

function tagBackupData(data) {
    let closestNode = kBucket.closestNode(data.receiverID);
    if (_list.stored.includes(closestNode))
        db.storeTag(closestNode, data);
}

function processTaskFromNextNode(packet) {
    var {
        from,
        message
    } = packet_.parse(packet)
    if (message) {
        message.forEach(task => {
            switch (task.type) {
                case RECONNECT_NEXT_NODE: //Triggered when a node inbetween is available
                    reconnectNextNode();
                    break;
                case BACKUP_HANDSHAKE_END:
                    handshakeEnd();
                    break;
                case DATA_REQUEST:
                    sendStoredData(task, from)
                    break;
                case DATA_SYNC:
                    dataSyncIndication(task, from)
                    break;
            }
        })
    }
}

function processTaskFromPrevNode(packet) {
    var {
        from,
        message
    } = packet_.parse(packet)
    if (message) {
        message.forEach(task => {
            switch (task.type) {
                case ORDER_BACKUP:
                    orderBackup(task.order);
                    break;
                case STORE_BACKUP_DATA:
                    storeBackupData(task.data)
                    break;
                case TAG_BACKUP_DATA:
                    tagBackupData(task)
                    break;
                case DATA_REQUEST:
                    sendStoredData(data.sn_msg.snID, data.from)
                    break;
                case DATA_SYNC:
                    dataSyncIndication(data.sn_msg.snID, data.sn_msg.mode, data.from)
                    break;
                case INITIATE_REFRESH:
                    initiateRefresh()
                    break;
            }
        });
    }
}

function processTaskFromSupernode(packet, ws) {
    var {
        from,
        message
    } = packet_.parse(packet)
    if (message) {
        message.forEach(task => {
            switch (task.type) {
                case BACKUP_HANDSHAKE_INIT:
                    handshakeMid(from, ws)
                    break;
                case STORE_MIGRATED_DATA:
                    storeMigratedData(data.sn_msg)
                    break;
            }
        });
    }
}

function processTask(packet, ws) {
    if (_prevNode.is(ws))
        processTaskFromPrevNode(packet)
    else
        processTaskFromSupernode(packet, ws)
}

module.exports = {
    processTask,
    setBlockchainParameters,
    SUPERNODE_INDICATOR
}