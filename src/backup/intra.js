'use strict';
const WebSocket = require('ws');
const { DB } = require('../database');
const keys = require('../keys');
const TYPE_ = require('./message_types.json');
const sync = require('./sync');

//CONSTANTS
const SUPERNODE_INDICATOR = '$',
    RETRY_TIMEOUT = 5 * 60 * 1000, //5 mins
    MIGRATE_WAIT_DELAY = 5 * 60 * 1000; //5 mins

var refresher; //container for and refresher

//List of node backups stored
const _list = {};
Object.defineProperty(_list, 'delete', {
    value: function (id) {
        delete this[id];
    }
});
Object.defineProperty(_list, 'get', {
    value: function (keys = null) {
        if (keys === null) keys = Object.keys(this);
        if (Array.isArray(keys))
            return Object.fromEntries(keys.map(k => [k, this[k]]));
        else
            return this[keys];
    }
});
Object.defineProperty(_list, 'stored', {
    get: function () {
        return Object.keys(this);
    }
});
Object.defineProperty(_list, 'serving', {
    get: function () {
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
        value: function (id, ws) {
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
        get: function () {
            return _id;
        }
    });
    Object.defineProperty(this, 'readyState', {
        get: function () {
            if (_ws instanceof WebSocket)
                return _ws.readyState;
            else
                return null;
        }
    });
    Object.defineProperty(this, 'send', {
        value: function (packet) {
            _ws.send(packet);
        }
    });
    Object.defineProperty(this, 'onmessage', {
        set: function (fn) {
            if (fn instanceof Function)
                _onmessage = fn;
        }
    });
    Object.defineProperty(this, 'onclose', {
        set: function (fn) {
            if (fn instanceof Function)
                _onclose = fn;
        }
    });
    Object.defineProperty(this, 'is', {
        value: function (ws) {
            return ws === _ws;
        }
    });
    Object.defineProperty(this, 'close', {
        value: function () {
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
packet_.construct = function (message) {
    const packet = {
        from: keys.node_id,
        message: message,
        time: Date.now()
    };
    packet.sign = floCrypto.signData(this.s(packet), keys.node_priv);
    return SUPERNODE_INDICATOR + JSON.stringify(packet);
};
packet_.s = d => [JSON.stringify(d.message), d.time].join("|");
packet_.parse = function (str) {
    try {
        let packet = JSON.parse(str.substring(SUPERNODE_INDICATOR.length));
        let curTime = Date.now();
        if (packet.time > curTime - floGlobals.sn_config.delayDelta &&
            packet.from in floGlobals.supernodes &&
            floCrypto.verifySign(this.s(packet), packet.sign, floGlobals.supernodes[packet.from].pubKey)) {
            if (!Array.isArray(packet.message))
                packet.message = [packet.message];
            return packet;
        } else
            return false;
    } catch (error) {
        console.error(str, error);
        return false;
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
        if (snID === keys.node_id)
            return reject(`Reached end of circle. Next node avaiable is self`);
        connectToNode(snID)
            .then(ws => resolve(ws))
            .catch(error => {
                var next = (reverse ? cloud.prevNode(snID) : cloud.nextNode(snID));
                connectToActiveNode(next, reverse)
                    .then(ws => resolve(ws))
                    .catch(error => reject(error));
            });
    });
};

//Connect to next available node
function connectToNextNode(curNode = keys.node_id) {
    return new Promise((resolve, reject) => {
        if (curNode === keys.node_id && !(keys.node_id in floGlobals.supernodes))
            return reject(`This (${keys.node_id}) is not a supernode`);
        let nextNodeID = cloud.nextNode(curNode);
        if (nextNodeID === keys.node_id)
            return reject("No other node online");
        connectToNode(nextNodeID).then(ws => {
            _nextNode.set(nextNodeID, ws);
            _nextNode.send(packet_.construct({
                type_: TYPE_.BACKUP_HANDSHAKE_INIT
            }));
            resolve("BACKUP_HANDSHAKE_INIT: " + nextNodeID);
        }).catch(error => {
            connectToNextNode(nextNodeID)
                .then(result => resolve(result))
                .catch(error => reject(error));
        });
    });
};

function connectToAliveNodes(nodes = null) {
    if (!Array.isArray(nodes)) nodes = Object.keys(floGlobals.supernodes);
    nodes = nodes.filter(n => n !== keys.node_id);
    return new Promise((resolve, reject) => {
        Promise.allSettled(nodes.map(n => connectToNode(n))).then(results => {
            let ws_connections = {};
            nodes.forEach((n, i) =>
                ws_connections[n] = (results[i].status === "fulfilled") ? results[i].value : null);
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
                ws_connections[n] = (results[i].status === "fulfilled") ? results[i].value : null);
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
            switch (task.type_) {
                case TYPE_.RECONNECT_NEXT_NODE: //Triggered when a node inbetween is available
                    reconnectNextNode(); break;
                case TYPE_.BACKUP_HANDSHAKE_END:
                    handshakeEnd(); break;
                case TYPE_.REQ_HASH:
                    sync.sendBlockHashes(task.node_i, _nextNode); break;
                case TYPE_.RES_HASH:
                    sync.checkBlockHash(task.node_i, task.block_n, task.hash); break;
                case TYPE_.VAL_LAST_BLK:
                    sync.setLastBlock(task.node_i, task.block_n); break;
                case TYPE_.REQ_BLOCK:
                    sync.sendBlockData(task.node_i, task.block_n, _nextNode); break;
                case TYPE_.INDICATE_BLK:
                    sync.syncIndicator(task.node_i, task.block_n, task.status, from); break;
                case TYPE_.STORE_BACKUP_DATA:
                    storeBackupData(task.data, from, packet); break;
                default:
                    console.warn("Invalid task type_:" + task.type_ + "from next-node");
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
            switch (task.type_) {
                case TYPE_.ORDER_BACKUP:
                    orderBackup(task.order); break;
                case TYPE_.STORE_BACKUP_DATA:
                    storeBackupData(task.data, from, packet); break;
                case TYPE_.TAG_BACKUP_DATA:
                    tagBackupData(task.data, from, packet); break;
                case TYPE_.NOTE_BACKUP_DATA:
                    noteBackupData(task.data, from, packet); break;
                case TYPE_.REQ_HASH:
                    sync.sendBlockHashes(task.node_i, _nextNode); break;
                case TYPE_.RES_HASH:
                    sync.checkBlockHash(task.node_i, task.block_n, task.hash); break;
                case TYPE_.VAL_LAST_BLK:
                    sync.setLastBlock(task.node_i, task.block_n); break;
                case TYPE_.REQ_BLOCK:
                    sync.sendBlockData(task.node_i, task.block_n, _nextNode); break;
                case TYPE_.INDICATE_BLK:
                    sync.syncIndicator(task.node_i, task.block_n, task.status, from); break;
                case TYPE_.DELETE_MIGRATED_DATA:
                    deleteMigratedData(task.data, from, packet); break;
                default:
                    console.warn("Invalid task type_:" + task.type_ + "from prev-node");
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
            switch (task.type_) {
                case TYPE_.BACKUP_HANDSHAKE_INIT:
                    handshakeMid(from, ws); break;
                case TYPE_.STORE_MIGRATED_DATA:
                    storeMigratedData(task.data); break;
                case TYPE_.INITIATE_REFRESH:
                    initiateRefresh(); break;
                default:
                    console.warn("Invalid task type_:" + task.type_ + "from super-node");
            };
        });
    };
};

//-----HANDSHAKE PROCESS-----

//Acknowledge handshake
function handshakeMid(id, ws) {
    if (_prevNode.id && _prevNode.id in floGlobals.supernodes) {
        if (cloud.innerNodes(_prevNode.id, keys.node_id).includes(id)) {
            //close existing prev-node connection
            _prevNode.send(packet_.construct({
                type_: TYPE_.RECONNECT_NEXT_NODE
            }));
            _prevNode.close();
            //set the new prev-node connection
            _prevNode.set(id, ws);
            _prevNode.send(packet_.construct({
                type_: TYPE_.BACKUP_HANDSHAKE_END
            }));
        } else {
            //Incorrect order, existing prev-node is already after the incoming node
            ws.send(packet_.construct({
                type_: TYPE_.RECONNECT_NEXT_NODE
            }));
            return;
        };
    } else {
        //set the new prev-node connection
        _prevNode.set(id, ws);
        _prevNode.send(packet_.construct({
            type_: TYPE_.BACKUP_HANDSHAKE_END
        }));
    };
    if (!_nextNode.id)
        reconnectNextNode();
    //Reorder storelist
    let nodes_inbtw = cloud.innerNodes(_prevNode.id, keys.node_id).concat(keys.node_id),
        req_sync = [],
        new_order = [];
    nodes_inbtw.forEach(n => {
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
    if (req_sync.length)
        req_sync.forEach(node_i => sync.requestDataSync(node_i, _nextNode));
    if (new_order.length) {
        let synced_list = new_order.filter(n => !req_sync.includes(n)); //send order only for synced disks
        _nextNode.send(packet_.construct({
            type_: TYPE_.ORDER_BACKUP,
            order: _list.get(synced_list)
        }));
    }
};

//Complete handshake
function handshakeEnd() {
    console.log("Backup connected: " + _nextNode.id);
    _nextNode.send(packet_.construct({
        type_: TYPE_.ORDER_BACKUP,
        order: _list.get()
    }));
};

//Reconnect to next available node
function reconnectNextNode() {
    if (_nextNode.id)
        _nextNode.close();
    connectToNextNode()
        .then(result => console.debug(result))
        .catch(error => {
            //Case: No other node is online
            console.info(error);
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
    let cur_serve = cloud.innerNodes(_prevNode.id, keys.node_id).concat(keys.node_id);
    for (let n in order) {
        if (!cur_serve.includes(n) && order[n] + 1 !== _list[n] && n in floGlobals.supernodes) {
            if (order[n] >= floGlobals.sn_config.backupDepth)
                DB.dropTable(n).then(_ => null)
                    .catch(error => console.error(error))
                    .finally(_ => _list.delete(n));
            else if (order[n] >= 0) {
                if (_list[n] === undefined)
                    req_sync.push(n);
                _list[n] = order[n] + 1;
                new_order.push(n);
            };
        };
    };
    if (req_sync.length)
        req_sync.forEach(node_i => sync.requestDataSync(node_i, _prevNode));
    if (new_order.length) {
        let synced_list = new_order.filter(n => !req_sync.includes(n)); //send order only for synced disks
        _nextNode.send(packet_.construct({
            type_: TYPE_.ORDER_BACKUP,
            order: _list.get(synced_list)
        }));
    }
};

//Store (backup) data
function storeBackupData(data, from, packet) {
    let closestNode = cloud.closestNode(data.receiverID);
    if (_list.stored.includes(closestNode)) {
        DB.storeData(closestNode, data).then(_ => null).catch(e => console.error(e));
        if (_list[closestNode] < floGlobals.sn_config.backupDepth && _nextNode.id !== from)
            _nextNode.send(packet);
    };
};

//Tag (backup) data
function tagBackupData(data, from, packet) {
    let closestNode = cloud.closestNode(data.receiverID);
    if (_list.stored.includes(closestNode)) {
        DB.storeTag(closestNode, data).then(_ => null).catch(e => console.error(e));
        if (_list[closestNode] < floGlobals.sn_config.backupDepth && _nextNode.id !== from)
            _nextNode.send(packet);
    };
};

//Note (backup) data
function noteBackupData(data, from, packet) {
    let closestNode = cloud.closestNode(data.receiverID);
    if (_list.stored.includes(closestNode)) {
        DB.storeNote(closestNode, data).then(_ => null).catch(e => console.error(e));
        if (_list[closestNode] < floGlobals.sn_config.backupDepth && _nextNode.id !== from)
            _nextNode.send(packet);
    };
};

//Store (migrated) data
function storeMigratedData(data) {
    let closestNode = cloud.closestNode(data.receiverID);
    if (_list.serving.includes(closestNode)) {
        DB.storeData(closestNode, data, true).then(_ => null).catch(e => console.error(e));
        _nextNode.send(packet_.construct({
            type_: TYPE_.STORE_BACKUP_DATA,
            data: data
        }));
    };
};

//Delete (migrated) data
function deleteMigratedData(data, from, packet) {
    let closestNode = cloud.closestNode(data.receiverID);
    if (data.snID !== closestNode && _list.stored.includes(data.snID)) {
        DB.deleteData(data.snID, data.vectorClock).then(_ => null).catch(e => console.error(e));
        if (_list[data.snID] < floGlobals.sn_config.backupDepth && _nextNode.id !== from)
            _nextNode.send(packet);
    };
};

function initiateRefresh() {
    refresher.invoke(false).then(_ => null).catch(_ => null);
};

//Forward incoming to next node
function forwardToNextNode(mode, data) {
    var modeMap = {
        'TAG': TYPE_.TAG_BACKUP_DATA,
        'NOTE': TYPE_.NOTE_BACKUP_DATA,
        'DATA': TYPE_.STORE_BACKUP_DATA
    };
    if (mode in modeMap && _nextNode.id)
        _nextNode.send(packet_.construct({
            type_: modeMap[mode],
            data: data
        }));
};

//Data migration processor
function dataMigration(node_change, flag) {
    if (flag) dataMigration.intimateAllNodes(); //Initmate All nodes to call refresher
    if (!Object.keys(node_change).length)
        return;
    console.log("Node list changed! Data migration required", node_change);
    let new_nodes = [],
        del_nodes = [];
    for (let n in node_change)
        (node_change[n] ? new_nodes : del_nodes).push(n);
    if (_prevNode.id && del_nodes.includes(_prevNode.id))
        _prevNode.close();
    const old_kb = cloud.kb;
    setTimeout(() => {
        //reconnect next node if current next node is deleted
        if (_nextNode.id) {
            if (del_nodes.includes(_nextNode.id))
                reconnectNextNode();
            else { //reconnect next node if there are newly added nodes in between self and current next node
                let innerNodes = cloud.innerNodes(keys.node_id, _nextNode.id);
                if (new_nodes.filter(n => innerNodes.includes(n)).length)
                    reconnectNextNode();
            };
        } else if (!_prevNode.id) {
            //no other nodes online: server all new nodes too
            new_nodes.forEach(n => {
                DB.createTable(n)
                    .then(result => _list[n] = 0)
                    .catch(error => console.error(error));
            });
        };

        setTimeout(() => {
            dataMigration.process_new(new_nodes);
            dataMigration.process_del(del_nodes, old_kb);
        }, MIGRATE_WAIT_DELAY);
    }, MIGRATE_WAIT_DELAY);
};

//data migration sub-process: Deleted nodes
dataMigration.process_del = async function (del_nodes, old_kb) {
    if (!del_nodes.length)
        return;
    let serve = _prevNode.id ? old_kb.innerNodes(_prevNode.id, keys.node_id) : _list.serving;
    let process_nodes = del_nodes.filter(n => serve.includes(n));
    if (process_nodes.length) {
        connectToAllActiveNodes().then(ws_connections => {
            let remaining = process_nodes.length;
            process_nodes.forEach(n => {
                console.info(`START: Data migration (del) for ${n}`);
                DB.readAllDataStream(n, 0, d => {
                    let closest = cloud.closestNode(d.receiverID);
                    if (_list.serving.includes(closest)) {
                        DB.storeData(closest, d, true).then(_ => null).catch(e => console.error(e));
                        if (_nextNode.id)
                            _nextNode.send(packet_.construct({
                                type_: TYPE_.STORE_BACKUP_DATA,
                                data: d
                            }));
                    } else
                        ws_connections[closest].send(packet_.construct({
                            type_: TYPE_.STORE_MIGRATED_DATA,
                            data: d
                        }));
                }).then(result => {
                    console.info(`END: Data migration (del) for ${n}`);
                    _list.delete(n);
                    DB.dropTable(n).then(_ => null).catch(e => console.error(e));
                }).catch(error => {
                    console.info(`ERROR: Data migration (del) for ${n}`);
                    console.error(error);
                }).finally(_ => remaining--);
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
            DB.dropTable(n).then(_ => null).catch(e => console.error(e));
        };
    });
};

//data migration sub-process: Added nodes
dataMigration.process_new = async function (new_nodes) {
    if (!new_nodes.length)
        return;
    connectToAllActiveNodes(new_nodes).then(ws_connections => {
        let process_nodes = _list.serving,
            remaining = process_nodes.length;
        process_nodes.forEach(n => {
            console.info(`START: Data migration (re-new) for ${n}`);
            DB.readAllDataStream(n, 0, d => {
                let closest = cloud.closestNode(d.receiverID);
                if (new_nodes.includes(closest)) {
                    if (_list.serving.includes(closest)) {
                        DB.storeData(closest, d, true).then(_ => null).catch(e => console.error(e));
                        if (_nextNode.id)
                            _nextNode.send(packet_.construct({
                                type_: TYPE_.STORE_BACKUP_DATA,
                                data: d
                            }));
                    } else
                        ws_connections[closest].send(packet_.construct({
                            type_: TYPE_.STORE_MIGRATED_DATA,
                            data: d
                        }));
                    DB.deleteData(n, d.vectorClock).then(_ => null).catch(e => console.error(e));
                    if (_nextNode.id)
                        _nextNode.send(packet_.construct({
                            type_: TYPE_.DELETE_MIGRATED_DATA,
                            data: {
                                vectorClock: d.vectorClock,
                                receiverID: d.receiverID,
                                snID: n
                            }
                        }));
                };
            }).then(result => console.info(`END: Data migration (re-new) for ${n}`))
                .catch(error => {
                    console.info(`ERROR: Data migration (re-new) for ${n}`);
                    console.error(error);
                }).finally(_ => remaining--);
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

dataMigration.intimateAllNodes = function () {
    connectToAliveNodes().then(ws_connections => {
        let packet = packet_.construct({
            type_: TYPE_.INITIATE_REFRESH
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
    _nextNode,
    _prevNode,
    packet_,
    set refresher(r) {
        refresher = r;
    }
};