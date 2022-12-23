'use strict';
const Database = require("../database");
const DB = Database.DB;
const floGlobals = require("../floGlobals");
const { H_struct, L_struct } = require("../data_structure.json");
const TYPE_ = require('./message_types.json');
const { _list, packet_, _nextNode } = require("./values");
const { SYNC_WAIT_TIME } = require('../_constants')['backup'];

const SESSION_GROUP_CONCAT_MAX_LENGTH = 100000 //MySQL default max value is 1024, which is too low for block grouping

const _x = {
    get block_calc_sql() {
        return `CEIL(CAST(${H_struct.VECTOR_CLOCK} AS UNSIGNED) / (${floGlobals.sn_config.blockInterval}))`;
    },
    block_range_sql(block_n) {
        let upper_vc = `${block_n * floGlobals.sn_config.blockInterval + 1}`,
            lower_vc = `${(block_n - 1) * floGlobals.sn_config.blockInterval + 1}`;
        return `${H_struct.VECTOR_CLOCK} > '${lower_vc}' AND ${H_struct.VECTOR_CLOCK} < '${upper_vc}'`;
    },
    get hash_algo_sql() {
        return `MD5(GROUP_CONCAT(${[H_struct.VECTOR_CLOCK, L_struct.LOG_TIME].join()}))`;
    },
    t_name(node_i) {
        return '_' + node_i;
    }
}

const queueSync = {
    list: {},

    init(node_i, ws) {
        if (node_i in this.list)
            return console.debug("Another sync is in process for ", node_i);
        console.info(`START: Data sync for ${node_i}`)
        this.list[node_i] = { ws, ts: Date.now(), q: [], cur: new Set(), ver: new Set(), hashes: {} };
        DB.createTable(node_i)
            .then(result => ws.send(packet_.construct({ type_: TYPE_.REQ_HASH, node_i })))
            .catch(error => console.error(error));
    },

    add_block(node_i, block_n, hash) {
        if (!(node_i in this.list))
            return console.error(`Queue-Sync: Not active for ${node_i}. Cannot request block ${block_n}`);
        let r = this.list[node_i];
        r.hashes[block_n] = hash;
        if (r.cur.size) //atleast a block is already in syncing process
            r.q.push(block_n);
        else {
            console.debug(`Queue-Sync: Started block sync for ${node_i}#${block_n}`);
            r.cur.add(block_n);
            r.ws.send(packet_.construct({ type_: TYPE_.REQ_BLOCK, node_i, block_n }))
        }
    },

    end_block(node_i, block_n) {
        if (!(node_i in this.list))
            return console.error(`Queue-Sync: Not active for ${node_i}. Cannot request block ${block_n}`);

        let r = this.list[node_i];
        if (!r.cur.has(block_n))
            return console.warn(`Queue-Sync: Block ${block_n} not currently syncing`);
        r.cur.delete(block_n);
        r.ver.add(block_n);
        console.debug(`Queue-Sync: Finished block sync for ${node_i}#${block_n}`);

        if (!r.cur.size && r.q.length) {
            //request next block
            let n = r.q.shift();
            console.debug(`Queue-Sync: Started block sync for ${node_i}#${n}`);
            r.cur.add(n);
            r.ws.send(packet_.construct({ type_: TYPE_.REQ_BLOCK, node_i, block_n: n }))
        }
        //verify hash of block after timeout
        setTimeout(() => verifyBlockHash(node_i, block_n, r.hashes[block_n]).then(verified => {
            if (!verified)  //hash mistmatch, resync
                this.add_block(node_i, block_n, r.hashes[block_n]);
            else //hash matched
                delete r.hashes[block_n];
            r.ver.delete(block_n);
        }).catch(error => console.error(error)), SYNC_WAIT_TIME);
    },

    last_block(node_i, block_n) {
        if (!(node_i in this.list))
            return console.error(`Queue-Sync: Not active for ${node_i}. Cannot request block ${block_n}`);
        let r = this.list[node_i];
        r.last_block = block_n;
        r.check_interval = setInterval(() => {
            if (!r.cur.size && !r.q.length && !r.ver.size) {
                if (Object.keys(r.hashes).length)
                    console.warn(`Queue-Sync: queue list is empty, but hash list is not empty for ${node_i}`);
                //all blocks synced, remove the sync instance
                console.info(`END: Data sync for ${node_i}`);
                clearInterval(r.check_interval);
                delete this.list[node_i];
                //indicate next node for ordering
                _nextNode.send(packet_.construct({
                    type_: TYPE_.ORDER_BACKUP,
                    order: _list.get([node_i])
                }));
            }
        }, SYNC_WAIT_TIME);
    }
};

function setSessionVar() {
    return new Promise((resolve, reject) => {
        Database.query(`SET SESSION group_concat_max_len = ${SESSION_GROUP_CONCAT_MAX_LENGTH}`)
            .then(result => resolve(result))
            .catch(error => reject(error))
    })
}

//R: request hashes for node_i
function requestDataSync(node_i, ws) {
    queueSync.init(node_i, ws);
}

//S: send hashes for node_i
function sendBlockHashes(node_i, ws) {
    let t_name = _x.t_name(node_i);
    setSessionVar().then(_ => {
        let statement = `SELECT ${_x.block_calc_sql} AS block_n, ${_x.hash_algo_sql} as hash`
            + ` FROM ${t_name} GROUP BY block_n ORDER BY block_n`;
        let last_block;
        Database.query_stream(statement, r => {
            ws.send(packet_.construct({
                type_: TYPE_.RES_HASH,
                node_i: node_i,
                block_n: r.block_n,
                hash: r.hash
            }));
            last_block = r.block_n;
        }).then(result => {
            console.debug(`Sent ${result} block hashes`);
            ws.send(packet_.construct({
                type_: TYPE_.VAL_LAST_BLK,
                node_i: node_i,
                block_n: last_block,
            }));
        }).catch(error => console.error(error))
    }).catch(error => console.error(error));
}

//R: check hash and request data if hash mismatch
function checkBlockHash(node_i, block_n, hash) {
    verifyBlockHash(node_i, block_n, hash).then(result => {
        if (!result) //Hash mismatch: ReSync block
            queueSync.add_block(node_i, block_n, hash)
    }).catch(error => console.error(error))
}

function verifyBlockHash(node_i, block_n, hash) {
    return new Promise((resolve, reject) => {
        let t_name = _x.t_name(node_i);
        setSessionVar().then(_ => {
            let statement = `SELECT ${_x.hash_algo_sql} as hash`
                + ` FROM ${t_name} WHERE ${_x.block_calc_sql}  = ?`;
            Database.query(statement, [block_n]).then(result => {
                if (!result.length || result[0].hash != hash) { //Hash mismatch
                    //ReSync Block
                    let clear_statement = `DELETE FROM ${t_name} WHERE ${_x.block_range_sql(block_n)}`;
                    Database.query(clear_statement)
                        .then(_ => resolve(false))
                        .catch(error => reject(error))
                } else //Hash is verified
                    resolve(true);
            }).catch(error => reject(error))
        }).catch(error => reject(error))
    })
}

//R: set last block number
function setLastBlock(node_i, block_n) {
    queueSync.last_block(node_i, block_n);
}

//S: send data for block
function sendBlockData(node_i, block_n, ws) {
    let t_name = _x.t_name(node_i);
    ws.send(packet_.construct({
        type_: TYPE_.INDICATE_BLK,
        node_i, block_n,
        status: true
    }))
    console.debug(`START: Sync-send ${node_i}#${block_n} to ${ws.id}`);
    let statement = `SELECT * FROM ${t_name} WHERE ${_x.block_calc_sql} = ?`;
    Database.query_stream(statement, [block_n], d => ws.send(packet_.construct({
        type_: TYPE_.STORE_BACKUP_DATA,
        data: d
    }))).then(result => console.debug(`END: Sync-send ${node_i}#${block_n} to ${ws.id} (${result} records)`))
        .catch(error => {
            console.debug(`ERROR: Sync-send ${node_i}#${block_n} to ${ws.id}`)
            console.error(error);
        }).finally(_ => ws.send(packet_.construct({
            type_: TYPE_.INDICATE_BLK,
            node_i, block_n,
            status: false
        })));
}

//R: end block 
function endBlockSync(node_i, block_n) {
    queueSync.end_block(node_i, block_n);
}

function syncIndicator(node_i, block_n, status, from) {
    console.debug(`${status ? 'Start' : 'End'}: Sync-receive ${node_i}#${block_n} from ${from}`);
    if (!status)
        endBlockSync(node_i, block_n);
}

module.exports = {
    requestDataSync,
    sendBlockHashes,
    checkBlockHash,
    setLastBlock,
    sendBlockData,
    syncIndicator
}
