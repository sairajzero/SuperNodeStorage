'use strict';
const WebSocket = require('ws');

//CONSTANTS
const SUPERNODE_INDICATOR = '$',
    //Message type
    ORDER_BACKUP = "orderBackup",
    STORE_BACKUP_DATA = "backupData",
    //STORE_MIGRATED_DATA = "migratedData",
    //DELETE_BACKUP_DATA = "backupDelete",
    TAG_BACKUP_DATA = "backupTag",
    //EDIT_BACKUP_DATA = "backupEdit",
    INITIATE_REFRESH = "initiateRefresh",
    DATA_REQUEST = "dataRequest",
    DATA_SYNC = "dataSync",
    BACKUP_HANDSHAKE_INIT = "handshakeInitate",
    BACKUP_HANDSHAKE_END = "handshakeEnd";

var DB //container for database

//List of node backups stored
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

//Node container
function NodeContainer() {
    var _ws, _id, _onmessage, _onclose;
    Object.defineProperty(this, 'set', {
        value: function(id, ws) {
            if (_ws !== undefined)
                this.close();
            _id = id;
            _ws = ws;
            if (_onmessage)
                _ws.onmessage = _onmessage;
            if (_onclose)
                _ws.onclose = _onclose;
        }
    })
    Object.defineProperty(this, 'id', {
        get: function() {
            return _id;
        }
    })
    Object.defineProperty(this, 'readyState', {
        get: function() {
            if (_ws instanceof WebSocket)
                return _ws.readyState;
            else
                return null;
        }
    })
    Object.defineProperty(this, 'send', {
        value: function(packet) {
            _ws.send(packet);
        }
    });
    Object.defineProperty(this, 'onmessage', {
        set: function(fn) {
            if (fn instanceof Function)
                _onmessage = fn;
        }
    })
    Object.defineProperty(this, 'onclose', {
        set: function(fn) {
            if (fn instanceof Function)
                _onclose = fn;
        }
    })
    Object.defineProperty(this, 'is', {
        value: function(ws) {
            return ws === _ws;
        }
    })
    Object.defineProperty(this, 'close', {
        value: function() {
            if (_ws.readyState === 1) {
                _ws.onclose = () => console.warn('Closing: ' + _id)
                _ws.close();
            }
            _ws = _id = undefined;
        }
    })
}

//Container for next-node
const _nextNode = new NodeContainer();
_nextNode.onmessage = evt => processTaskFromNextNode(evt.data);
_nextNode.onclose = evt => reconnectNextNode();
//Container for prev-node
const _prevNode = new NodeContainer();
_prevNode.onmessage = evt => processTaskFromPrevNode(evt.data);
_prevNode.onclose = evt => _prevNode.close();

//Packet processing
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
    if (packet.time > curTime - floGlobals.sn_config.delayDelta &&
        floCrypto.verifySign(this.s(packet), packet.sign, floGlobals.supernodes[packet.from].pubKey)) {
        if (!Array.isArray(packet.message))
            packet.message = [packet.message];
        return packet;
    }
}

//-----NODE CONNECTORS (WEBSOCKET)-----

//Connect to Node websocket
function connectToNode(snID) {
    return new Promise((resolve, reject) => {
        if (!(snID in floGlobals.supernodes))
            return reject(`${snID} is not a supernode`)
        const ws = new WebSocket("wss://" + floGlobals.supernodes[nextNodeID].uri + "/");
        ws.on("error", () => reject(`${snID} is offline`));
        ws.on('open', () => resolve(ws));
    })
}

//Connect to Node websocket thats online
function connectToActiveNode(snID, reverse = false) {
    return new Promise((resolve, reject) => {
        if (!(snID in floGlobals.supernodes))
            return reject(`${snID} is not a supernode`)
        if (snID === myFloID)
            return reject(`Reached end of circle. Next node avaiable is self`)
        connectToNode(snID)
            .then(ws => resolve(ws))
            .catch(error => {
                var next = reverse ? kBucket.prevNode(snID) : kBucket.nextNode(snID)
                connectToActiveNode(next, reverse)
                    .then(ws => resolve(ws))
                    .catch(error => reject(error))
            })
    })
}

//Connect to next available node
function connectToNextNode() {
    return new Promise((resolve, reject) => {
        let nextNodeID = kBucket.nextNode(nodeID);
        connectToActiveNode(nextNodeID).then(ws => {
            _nextNode.set(nextNodeID, ws)
            _nextNode.send(packet_.constuct({
                type: BACKUP_HANDSHAKE_INIT
            }));
            resolve("BACKUP_HANDSHAKE_INIT: " + nextNodeID)
        }).catch(error => reject(error))
    })
}

//-----PROCESS TASKS-----

//Tasks from next-node
function processTaskFromNextNode(packet) {
    var {
        from,
        message
    } = packet_.parse(packet)
    if (message) {
        message.forEach(task => {
            switch (task.type) {
                case RECONNECT_NEXT_NODE: //Triggered when a node inbetween is available
                    reconnectNextNode()
                    break;
                case BACKUP_HANDSHAKE_END:
                    handshakeEnd()
                    break;
                case DATA_REQUEST:
                    sendStoredData(task.nodes, _nextNode)
                    break;
                case DATA_SYNC:
                    dataSyncIndication(task.id, task.status, from)
                    break;
                case STORE_BACKUP_DATA:
                    storeBackupData(task.data)
                    break;
            }
        })
    }
}

//Tasks from prev-node
function processTaskFromPrevNode(packet) {
    var {
        from,
        message
    } = packet_.parse(packet)
    if (message) {
        message.forEach(task => {
            switch (task.type) {
                case ORDER_BACKUP:
                    orderBackup(task.order)
                    break;
                case STORE_BACKUP_DATA:
                    storeBackupData(task.data, from, packet)
                    break;
                case TAG_BACKUP_DATA:
                    tagBackupData(task.data, from, packet)
                    break;
                case DATA_REQUEST:
                    sendStoredData(task.nodes, _prevNode)
                    break;
                case DATA_SYNC:
                    dataSyncIndication(task.id, task.status, from)
                    break;
                case INITIATE_REFRESH: //TODO
                    initiateRefresh()
                    break;
            }
        });
    }
}

//Tasks from any supernode
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
                /*
                case STORE_MIGRATED_DATA: //TODO
                    storeMigratedData(task.data)
                    break;
                */
            }
        });
    }
}

//-----HANDSHAKE PROCESS-----

//Acknowledge handshake
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
    Promise.all(req_sync.forEach(n => DB.createGetLastLog(n))).then(result => {
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

//Complete handshake
function handshakeEnd() {
    console.log("Backup connected: " + _nextNode.id)
    _nextNode.send(packet_.constuct({
        type: ORDER_BACKUP,
        order: _list.get()
    }))
}

//Reconnect to next available node
function reconnectNextNode() {
    _nextNode.close();
    connectToNextNode()
        .then(result => console.log(result))
        .catch(error => {
            //Case: No other node is online
            console.error(error);
            //Serve all nodes
            for (let sn in floGlobals.supernodes)
                DB.createTable(sn)
                .then(result => _list[sn] = 0)
                .catch(error => console.error(error))
        })
}

//-----BACKUP TASKS-----

//Order the stored backup
function orderBackup(order) {
    let new_order = [];
    let cur_serve = kBucket.innerNodes(_prevNode.id, myFloID);
    for (let n in order) {
        if (order[n] + 1 !== _list[n]) {
            if (order[n] >= floGlobals.sn_config.backupDepth)
                DB.dropTable(n).then(_ => null)
                .catch(error => console.error(error))
                .finally(_ => _list.delete(n))
            else if (_list[n] !== 0 || !cur_serve.includes(n)) {
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

//Send stored data
function sendStoredData(lastlogs, node) {
    for (n in lastlogs) {
        if (_list.stored.includes(n)) {
            DB.getData(n, lastlogs[n]).then(result => {
                node.send(packet_.constuct({
                    type: DATA_SYNC,
                    id: n,
                    status: true
                }))
                console.info(`START: ${snID} data sync(send) to ${node.id}`)
                //TODO: efficiently handle large number of data instead of loading all into memory
                result.forEach(d => node.send(packet_.constuct({
                    type: STORE_BACKUP_DATA,
                    data: d
                })))
                console.info(`END: ${snID} data sync(send) to ${node.id}`)
                node.send(packet_.constuct({
                    type: DATA_SYNC,
                    id: n,
                    status: false
                }))
            }).catch(error => console.error(error))
        }
    }
}

//Indicate sync of data
function dataSyncIndication(snID, status, from) {
    console.info(`${status ? 'START':'END'}: ${snID} data sync(receive) form ${from}`);
}

//Store (backup) data
function storeBackupData(data, from, packet) {
    let closestNode = kBucket.closestNode(data.receiverID);
    if (_list.stored.includes(closestNode)) {
        DB.storeData(closestNode, data);
        if (_list[closestNode] < floGlobals.sn_config.backupDepth &&
            _nextNode.id !== from)
            _nextNode.send(packet);
    }
}

//Tag (backup) data
function tagBackupData(data, from, packet) {
    let closestNode = kBucket.closestNode(data.receiverID);
    if (_list.stored.includes(closestNode)) {
        DB.storeTag(closestNode, data);
        if (_list[closestNode] < floGlobals.sn_config.backupDepth &&
            _nextNode.id !== from)
            _nextNode.send(packet);
    }
}

//Forward incoming to next node
function forwardToNextNode(mode, data) {
    var modeMap = {
        'TAG': TAG_BACKUP_DATA,
        'DATA': STORE_BACKUP_DATA
    }
    if (mode in modeMap && _nextNode.id)
        _nextNode.send(packet_.constuct({
            type: modeMap[mode],
            data: data
        }));
}

function dataMigration(node_change){
    console.log("data migration")
    //TODO
}

//-----EXPORTS-----
module.exports = {
    processTaskFromSupernode,
    setBlockchainParameters,
    forwardToNextNode,
    dataMigration,
    SUPERNODE_INDICATOR,
    _list,
    set DB(db){
        DB = db
    }
}