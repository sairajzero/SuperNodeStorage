'use strict';
const WebSocket = require('ws');

//CONSTANTS
const SUPERNODE_INDICATOR = '$',
    //Message type
    ORDER_BACKUP = "orderBackup",
    STORE_BACKUP_DATA = "backupData",
    STORE_MIGRATED_DATA = "migratedData",
    DELETE_MIGRATED_DATA = "migratedDelete",
    //DELETE_BACKUP_DATA = "backupDelete",
    TAG_BACKUP_DATA = "backupTag",
    //EDIT_BACKUP_DATA = "backupEdit",
    INITIATE_REFRESH = "initiateRefresh",
    DATA_REQUEST = "dataRequest",
    DATA_SYNC = "dataSync",
    BACKUP_HANDSHAKE_INIT = "handshakeInitate",
    BACKUP_HANDSHAKE_END = "handshakeEnd",
    RECONNECT_NEXT_NODE = "reconnectNextNode",
    RETRY_TIMEOUT = 5 * 60 * 1000, //5 mins
    MIGRATE_WAIT_DELAY = 5 * 60 * 1000; //5 mins

var DB, refresher; //container for database and refresher

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
});
Object.defineProperty(_list, 'stored', {
    get: function() {
        return Object.keys(this);
    }
});
Object.defineProperty(_list, 'serving', {
    get: function() {
        let serveList = [];
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
    });
    Object.defineProperty(this, 'id', {
        get: function() {
            return _id;
        }
    });
    Object.defineProperty(this, 'readyState', {
        get: function() {
            if (_ws instanceof WebSocket)
                return _ws.readyState;
            else
                return null;
        }
    });
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
    });
    Object.defineProperty(this, 'onclose', {
        set: function(fn) {
            if (fn instanceof Function)
                _onclose = fn;
        }
    });
    Object.defineProperty(this, 'is', {
        value: function(ws) {
            return ws === _ws;
        }
    });
    Object.defineProperty(this, 'close', {
        value: function() {
            if (_ws.readyState === 1) {
                _ws.onclose = () => console.warn('Closing: ' + _id);
                _ws.close();
            };
            _ws = _id = undefined;
        }
    });
};

//Container for next-node
const _nextNode = new NodeContainer();
_nextNode.onmessage = evt => processTaskFromNextNode(evt.data);
_nextNode.onclose = evt => reconnectNextNode();
//Container for prev-node
const _prevNode = new NodeContainer();
_prevNode.onmessage = evt => processTaskFromPrevNode(evt.data);
_prevNode.onclose = evt => _prevNode.close();

//Packet processing
const packet_ = {};
packet_.constuct = function(message) {
    const packet = {
        from: myFloID,
        message: message,
        time: Date.now()
    };
    packet.sign = floCrypto.signData(this.s(packet), myPrivKey);
    return SUPERNODE_INDICATOR + JSON.stringify(packet);
};
packet_.s = d => [JSON.stringify(d.message), d.time].join("|");
packet_.parse = function(str) {
    let packet = JSON.parse(str.substring(SUPERNODE_INDICATOR.length));
    let curTime = Date.now();
    if (packet.time > curTime - floGlobals.sn_config.delayDelta &&
        packet.from in floGlobals.supernodes &&
        floCrypto.verifySign(this.s(packet), packet.sign, floGlobals.supernodes[packet.from].pubKey)) {
        if (!Array.isArray(packet.message))
            packet.message = [packet.message];
        return packet;
    };
};

//-----NODE CONNECTORS (WEBSOCKET)-----

//Connect to Node websocket
function connectToNode(snID) {
    return new Promise((resolve, reject) => {
        if (!(snID in floGlobals.supernodes))
            return reject(`${snID} is not a supernode`);
        const ws = new WebSocket("wss://" + floGlobals.supernodes[snID].uri + "/");
        ws.on("error", () => reject(`${snID} is offline`));
        ws.on('open', () => resolve(ws));
    });
};

//Connect to Node websocket thats online
function connectToActiveNode(snID, reverse = false) {
    return new Promise((resolve, reject) => {
        if (!(snID in floGlobals.supernodes))
            return reject(`${snID} is not a supernode`);
        if (snID === myFloID)
            return reject(`Reached end of circle. Next node avaiable is self`);
        connectToNode(snID)
            .then(ws => resolve(ws))
            .catch(error => {
                var next = (reverse ? kBucket.prevNode(snID) : kBucket.nextNode(snID));
                connectToActiveNode(next, reverse)
                    .then(ws => resolve(ws))
                    .catch(error => reject(error));
            });
    });
};

//Connect to next available node
function connectToNextNode() {
    return new Promise((resolve, reject) => {
        let nextNodeID = kBucket.nextNode(myFloID);
        connectToActiveNode(nextNodeID).then(ws => {
            _nextNode.set(nextNodeID, ws);
            _nextNode.send(packet_.constuct({
                type: BACKUP_HANDSHAKE_INIT
            }));
            resolve("BACKUP_HANDSHAKE_INIT: " + nextNodeID);
        }).catch(error => reject(error));
    });
};

function connectToAliveNodes(nodes = null) {
    if (!Array.isArray(nodes)) nodes = Object.keys(floGlobals.supernodes);
    return new Promise((resolve, reject) => {
        Promise.allSettled(nodes.map(n => connectToNode(n))).then(results => {
            let ws_connections = {};
            nodes.forEach((n, i) =>
                ws_connections[n] = (results.status === "fulfilled") ? results[i].value : null);
            resolve(ws_connections);
        });
    });
};

//Connect to all given nodes [Array] (Default: All super-nodes)
function connectToAllActiveNodes(nodes = null) {
    if (!Array.isArray(nodes)) nodes = Object.keys(floGlobals.supernodes);
    return new Promise((resolve, reject) => {
        Promise.allSettled(nodes.map(n => connectToActiveNode(n))).then(results => {
            let ws_connections = {};
            nodes.forEach((n, i) =>
                ws_connections[n] = (results.status === "fulfilled") ? results[i].value : null);
            resolve(ws_connections);
        });
    });
};

//-----PROCESS TASKS-----

//Tasks from next-node
function processTaskFromNextNode(packet) {
    console.debug("_nextNode: ", packet);
    var {
        from,
        message
    } = packet_.parse(packet);
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
                    sendStoredData(task.nodes, _nextNode);
                    break;
                case DATA_SYNC:
                    dataSyncIndication(task.id, task.status, from);
                    break;
                case STORE_BACKUP_DATA:
                    storeBackupData(task.data);
                    break;
                default:
                    console.log("Invalid task type:" + task.type + "from next-node");
            };
        });
    };
};

//Tasks from prev-node
function processTaskFromPrevNode(packet) {
    console.debug("_prevNode: ", packet);
    var {
        from,
        message
    } = packet_.parse(packet);
    if (message) {
        message.forEach(task => {
            switch (task.type) {
                case ORDER_BACKUP:
                    orderBackup(task.order);
                    break;
                case STORE_BACKUP_DATA:
                    storeBackupData(task.data, from, packet);
                    break;
                case TAG_BACKUP_DATA:
                    tagBackupData(task.data, from, packet);
                    break;
                case DATA_REQUEST:
                    sendStoredData(task.nodes, _prevNode);
                    break;
                case DATA_SYNC:
                    dataSyncIndication(task.id, task.status, from);
                    break;
                case DELETE_MIGRATED_DATA:
                    deleteMigratedData(task.data, from, packet);
                    break;
                default:
                    console.log("Invalid task type:" + task.type + "from prev-node");
            };
        });
    };
};

//Tasks from any supernode
function processTaskFromSupernode(packet, ws) {
    console.debug("superNode: ", packet);
    var {
        from,
        message
    } = packet_.parse(packet);
    if (message) {
        message.forEach(task => {
            switch (task.type) {
                case BACKUP_HANDSHAKE_INIT:
                    handshakeMid(from, ws);
                    break;
                case STORE_MIGRATED_DATA:
                    storeMigratedData(task.data);
                    break;
                case INITIATE_REFRESH:
                    initiateRefresh();
                    break;
                default:
                    console.log("Invalid task type:" + task.type + "from super-node");
            };
        });
    };
};

//-----HANDSHAKE PROCESS-----

//Acknowledge handshake
function handshakeMid(id, ws) {
    if (_prevNode.id && _prevNode.id in floGlobals.supernodes) {
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
            }));
        } else {
            //Incorrect order, existing prev-node is already after the incoming node
            ws.send(packet_.constuct({
                type: RECONNECT_NEXT_NODE
            }));
            return;
        };
    } else {
        //set the new prev-node connection
        _prevNode.set(id, ws);
        _prevNode.send(packet_.constuct({
            type: BACKUP_HANDSHAKE_END
        }));
    };
    if (!_nextNode.id)
        reconnectNextNode();
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
        };
    });
    if (!req_sync.length && !new_order.length)
        return; //No order change and no need for any data sync
    else
        handshakeMid.requestData(req_sync, new_order);
};

handshakeMid.requestData = function(req_sync, new_order) {
    if (handshakeMid.timeout) {
        clearTimeout(handshakeMid.timeout);
        delete handshakeMid.timeout;
    };
    Promise.allSettled(req_sync.map(n => DB.createGetLastLog(n))).then(result => {
        let tasks = [],
            lastlogs = {},
            failed = [],
            order = [],
            failed_order = [];

        req_sync.forEach((s, i) => {
            if (result[i].status === "fulfilled")
                lastlogs[s] = result[i].value;
            else
                failed.push(s);
        });
        if (Object.keys(lastlogs).length)
            tasks.push({
                type: DATA_REQUEST,
                nodes: lastlogs
            });
        new_order.forEach(n => {
            if (failed.includes(n))
                failed_order.push(n);
            else
                order.push(n);
        });
        if (order.length)
            tasks.push({
                type: ORDER_BACKUP,
                order: _list.get(order)
            });
        _nextNode.send(packet_.constuct(tasks));
        if (failed.length)
            handshakeMid.timeout = setTimeout(_ => handshakeMid.requestData(failed, failed_order), RETRY_TIMEOUT);
    });
};

//Complete handshake
function handshakeEnd() {
    console.log("Backup connected: " + _nextNode.id);
    _nextNode.send(packet_.constuct({
        type: ORDER_BACKUP,
        order: _list.get()
    }));
};

//Reconnect to next available node
function reconnectNextNode() {
    if (_nextNode.ws)
        _nextNode.close();
    connectToNextNode()
        .then(result => console.log(result))
        .catch(error => {
            //Case: No other node is online
            console.info("No other node online");
            //Serve all nodes
            for (let sn in floGlobals.supernodes)
                DB.createTable(sn)
                .then(result => _list[sn] = 0)
                .catch(error => console.error(error));
        });
};

//-----BACKUP TASKS-----

//Order the stored backup
function orderBackup(order) {
    let new_order = [],
        req_sync = [];
    let cur_serve = kBucket.innerNodes(_prevNode.id, myFloID).concat(myFloID);
    for (let n in order) {
        if (!cur_serve.includes(n) && order[n] + 1 !== _list[n]) {
            if (order[n] >= floGlobals.sn_config.backupDepth)
                DB.dropTable(n).then(_ => null)
                .catch(error => console.error(error))
                .finally(_ => _list.delete(n));
            else {
                if (_list[n] === undefined)
                    req_sync.push(n);
                _list[n] = order[n] + 1;
                new_order.push(n);
            };
        };
    };
    if (!req_sync.length && !new_order.length)
        return; //No order change and no need for any data sync
    else
        orderBackup.requestData(req_sync, new_order);
};

orderBackup.requestData = function(req_sync, new_order) {
    Promise.allSettled(req_sync.map(n => DB.createGetLastLog(n))).then(result => {
        let
            lastlogs = {},
            failed = [],
            order = [],
            failed_order = [];

        req_sync.forEach((s, i) => {
            if (result[i].status === "fulfilled")
                lastlogs[s] = result[i].value;
            else
                failed.push(s);
        });
        if (Object.keys(lastlogs).length)
            _prevNode.send(packet_.constuct({
                type: DATA_REQUEST,
                nodes: lastlogs
            }));
        new_order.forEach(n => {
            if (failed.includes(n))
                failed_order.push(n);
            else
                order.push(n);
        });
        if (order.length) //TODO: maybe should wait for sync to finish?
            _nextNode.send(packet_.constuct({
                type: ORDER_BACKUP,
                order: _list.get(order)
            }));
        if (failed.length)
            setTimeout(_ => orderBackup.requestData(failed, failed_order), RETRY_TIMEOUT);
    });
};

//Send stored data
function sendStoredData(lastlogs, node) {
    for (let n in lastlogs) {
        if (_list.stored.includes(n)) {
            DB.getData(n, lastlogs[n]).then(result => {
                node.send(packet_.constuct({
                    type: DATA_SYNC,
                    id: n,
                    status: true
                }));
                console.log(`START: ${n} data sync(send) to ${node.id}`);
                //TODO: efficiently handle large number of data instead of loading all into memory
                result.forEach(d => node.send(packet_.constuct({
                    type: STORE_BACKUP_DATA,
                    data: d
                })));
                console.log(`END: ${n} data sync(send) to ${node.id}`);
                node.send(packet_.constuct({
                    type: DATA_SYNC,
                    id: n,
                    status: false
                }));
            }).catch(error => console.error(error));
        };
    };
};

//Indicate sync of data
function dataSyncIndication(snID, status, from) {
    console.log(`${status ? 'START':'END'}: ${snID} data sync(receive) form ${from}`);
};

//Store (backup) data
function storeBackupData(data, from, packet) {
    let closestNode = kBucket.closestNode(data.receiverID);
    if (_list.stored.includes(closestNode)) {
        DB.storeData(closestNode, data);
        if (_list[closestNode] < floGlobals.sn_config.backupDepth && _nextNode.id !== from)
            _nextNode.send(packet);
    };
};

//Tag (backup) data
function tagBackupData(data, from, packet) {
    let closestNode = kBucket.closestNode(data.receiverID);
    if (_list.stored.includes(closestNode)) {
        DB.storeTag(closestNode, data);
        if (_list[closestNode] < floGlobals.sn_config.backupDepth && _nextNode.id !== from)
            _nextNode.send(packet);
    };
};

//Store (migrated) data
function storeMigratedData(data) {
    let closestNode = kBucket.closestNode(data.receiverID);
    if (_list.serving.includes(closestNode)) {
        DB.storeData(closestNode, data);
        _nextNode.send(packet_.constuct({
            type: STORE_BACKUP_DATA,
            data: data
        }));
    };
};

//Delete (migrated) data
function deleteMigratedData(old_sn, vectorClock, receiverID, from, packet) {
    let closestNode = kBucket.closestNode(receiverID);
    if (old_sn !== closestNode && _list.stored.includes(old_sn)) {
        DB.deleteData(old_sn, vectorClock);
        if (_list[old_sn] < floGlobals.sn_config.backupDepth && _nextNode.id !== from)
            _nextNode.send(packet);
    };
};

function initiateRefresh() {
    refresher.invoke(false).then(_ => null).catch(_ => null);
};

//Forward incoming to next node
function forwardToNextNode(mode, data) {
    var modeMap = {
        'TAG': TAG_BACKUP_DATA,
        'DATA': STORE_BACKUP_DATA
    };
    if (mode in modeMap && _nextNode.id)
        _nextNode.send(packet_.constuct({
            type: modeMap[mode],
            data: data
        }));
};

//Data migration processor
function dataMigration(node_change, flag) {
    if (!Object.keys(node_change).length)
        return;
    console.log("Node list changed! Data migration required");
    if (flag) dataMigration.intimateAllNodes(); //Initmate All nodes to call refresher
    let new_nodes = [],
        del_nodes = [];
    for (let n in node_change)
        (node_change[n] ? new_nodes : del_nodes).push(n);
    if (del_nodes.includes(_prevNode.id)) {
        _list[_prevNode.id] = 0; //Temporary serve for the deleted node
        _prevNode.close();
    };
    setTimeout(() => {
        //reconnect next node if current next node is deleted
        if (del_nodes.includes(_nextNode.id))
            reconnectNextNode();
        else { //reconnect next node if there are newly added nodes in between self and current next node
            let innerNodes = kBucket.innerNodes(myFloID, _nextNode.id);
            if (new_nodes.filter(n => innerNodes.includes(n)).length)
                reconnectNextNode();
        };
        setTimeout(() => {
            dataMigration.process_new(new_nodes);
            dataMigration.process_del(del_nodes);
        }, MIGRATE_WAIT_DELAY);
    }, MIGRATE_WAIT_DELAY);
};

//data migration sub-process: Deleted nodes
dataMigration.process_del = async function(del_nodes) {
    if (!del_nodes.length)
        return;
    let process_nodes = del_nodes.filter(n => _list.serving.includes(n));
    if (process_nodes.length) {
        connectToAllActiveNodes().then(ws_connections => {
            let remaining = process_nodes.length;
            process_nodes.forEach(n => {
                DB.getData(n, 0).then(result => {
                    console.log(`START: Data migration for ${n}`);
                    //TODO: efficiently handle large number of data instead of loading all into memory
                    result.forEach(d => {
                        let closest = kBucket.closestNode(d.receiverID);
                        if (_list.serving.includes(closest)) {
                            DB.storeData(closest, d);
                            _nextNode.send(packet_.constuct({
                                type: STORE_BACKUP_DATA,
                                data: d
                            }));
                        } else
                            ws_connections[closest].send(packet_.constuct({
                                type: STORE_MIGRATED_DATA,
                                data: d
                            }));
                    });
                    console.log(`END: Data migration for ${n}`);
                    _list.delete(n);
                    DB.dropTable(n);
                    remaining--;
                }).catch(error => reject(error));
            });
            const interval = setInterval(() => {
                if (remaining <= 0) {
                    for (let c in ws_connections)
                        if (ws_connections[c])
                            ws_connections[c].close();
                    clearInterval(interval);
                };
            }, RETRY_TIMEOUT);
        });
    };
    del_nodes.forEach(n => {
        if (!process_nodes.includes(n) && _list.stored.includes(n)) {
            _list.delete(n);
            DB.dropTable(n);
        };
    });
};

//data migration sub-process: Added nodes
dataMigration.process_new = async function(new_nodes) {
    if (!new_nodes.length)
        return;
    connectToAllActiveNodes(new_nodes).then(ws_connections => {
        let process_nodes = _list.serving,
            remaining = process_nodes.length;
        process_nodes.forEach(n => {
            DB.getData(n, 0).then(result => {
                //TODO: efficiently handle large number of data instead of loading all into memory
                result.forEach(d => {
                    let closest = kBucket.closestNode(d.receiverID);
                    if (new_nodes.includes(closest)) {
                        if (_list.serving.includes(closest)) {
                            DB.storeData(closest, d);
                            _nextNode.send(packet_.constuct({
                                type: STORE_BACKUP_DATA,
                                data: d
                            }));
                        } else
                            ws_connections[closest].send(packet_.constuct({
                                type: STORE_MIGRATED_DATA,
                                data: d
                            }));
                        _nextNode.send(packet_.constuct({
                            type: DELETE_MIGRATED_DATA,
                            vectorClock: d.vectorClock,
                            receiverID: d.receiverID,
                            snID: n
                        }));
                    };
                });
                remaining--;
            }).catch(error => reject(error));
        });
        const interval = setInterval(() => {
            if (remaining <= 0) {
                for (let c in ws_connections)
                    if (ws_connections[c])
                        ws_connections[c].close();
                clearInterval(interval);
            };
        }, RETRY_TIMEOUT);
    });
};

dataMigration.intimateAllNodes = function() {
    connectToAliveNodes().then(ws_connections => {
        let packet = packet_.constuct({
            type: INITIATE_REFRESH
        });
        for (let n in ws_connections)
            if (ws_connections[n]) {
                ws_connections[n].send(packet);
                ws_connections[n].close();
            };
    });
};

const logInterval = setInterval(() => {
    console.debug(_prevNode.id, _nextNode.id, _list.get());
}, RETRY_TIMEOUT);

//-----EXPORTS-----
module.exports = {
    reconnectNextNode,
    processTaskFromSupernode,
    forwardToNextNode,
    dataMigration,
    logInterval,
    SUPERNODE_INDICATOR,
    _list,
    set DB(db) {
        DB = db;
    },
    set refresher(r) {
        refresher = r;
    }
};