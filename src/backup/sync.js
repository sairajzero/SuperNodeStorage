const Database = require("../database");
const DB = Database.DB;
const floGlobals = require("../floGlobals");
const { H_struct } = require("../data_structure.json");
const { packet_, _nextNode, _list } = require("./intra");
const TYPE = require('./message_types.json');

const SYNC_WAIT_TIME = 5 * 60 * 1000 //5 mins

const queueSync = {
    list: {},

    init(node_i, ws) {
        if (node_i in this.list)
            return console.debug("Another sync is in process for ", node_i);
        console.init(`START: Data sync for ${node_i}`)
        this.list[node_i] = { ws, ts: Date.now(), q: [], cur: new Set(), hashes: {} };
        DB.createTable(node_i)
            .then(result => ws.send(packet_.construct({ type_: TYPE.REQ_HASH, node_i })))
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
            r.ws.send(packet_.construct({ type_: TYPE.REQ_BLOCK, node_i, block_n }))
        }
    },

    end_block(node_i, block_n) {
        if (!(node_i in this.list))
            return console.error(`Queue-Sync: Not active for ${node_i}. Cannot request block ${block_n}`);

        let r = this.list[node_i];
        if (!r.cur.has(block_n))
            return console.warn(`Queue-Sync: Block ${block_n} not currently syncing`);
        r.cur.delete(block_n);
        console.debug(`Queue-Sync: Finished block sync for ${node_i}#${block_n}`);

        if (r.last_block && block_n === r.last_block)
            r.last_block_done = true;

        if (!r.cur.size && r.q.length) {
            //request next block
            let n = r.q.shift();
            console.debug(`Queue-Sync: Started block sync for ${node_i}#${n}`);
            r.cur.add(n);
            r.ws.send(packet_.construct({ type_: TYPE.REQ_BLOCK, node_i, block_n: n }))
        }
        //verify hash of block after timeout
        setTimeout(() => verifyBlockHash(node_i, block_n, r.hashes[block_n]).then(verified => {
            if (!verified)  //hash mistmatch, resync
                this.add_block(node_i, block_n, r.hashes[block_n]);
            else {//hash matched
                delete r.hashes[block_n];
                if (!r.cur.size && !r.q.length && r.last_block_done) {
                    if (Object.keys(r.hashes).length)
                        console.warn(`Queue-Sync: queue list is empty, but hash list is not empty for ${node_i}`);
                    //all blocks synced, remove the sync instance
                    delete this.list[node_i];
                    //indicate next node for ordering
                    _nextNode.send(packet_.construct({
                        type_: TYPE_.ORDER_BACKUP,
                        order: _list.get([node_i])
                    }));
                }
            }
        }).catch(error => console.error(error)), SYNC_WAIT_TIME);
    },

    last_block(node_i, block_n) {
        if (!(node_i in this.list))
            return console.error(`Queue-Sync: Not active for ${node_i}. Cannot request block ${block_n}`);
        this.list[node_i].last_block = block_n;
    }
};

const _ = {
    get block_calc_sql() {
        return `CEIL(CAST(${H_struct.VECTOR_CLOCK} AS UNSIGNED) / (${floGlobals.sn_config.hash_n}))`
    },
    t_name(node_i) {
        return '_' + node_i;
    }
}

function getColumns(t_name) {
    return new Promise((resolve, reject) => {
        Database.query("SHOW COLUMNS FROM " + t_name)
            .then(result => resolve(result.map(r => r["Field"]).sort()))
            .catch(error => reject(error))
    })
}

//R: request hashes for node_i
function requestDataSync(node_i, ws) {
    queueSync.init(node_i, ws);
}

//S: send hashes for node_i
function sendBlockHashes(node_i, ws) {
    let t_name = _.t_name(node_i);
    getColumns(t_name).then(columns => {
        let statement = `SELECT ${_.block_calc_sql} AS block_n,`
            + `MD5(GROUP_CONCAT(${columns.map(c => `IFNULL(${c}, "NULL")`).join()})) as hash`
            + `FROM ${t_name} GROUP BY block_n ORDER BY block_n`;
        let last_block;
        Database.query_stream(statement, r => {
            ws.send(packet_.construct({
                type_: TYPE.RES_HASH,
                node_i: node_i,
                block_n: r.block_n,
                hash: r.hash
            }));
            last_block = r.block_n;
        }).then(result => {
            console.debug(`Send ${result} block hashes`);
            ws.send(packet_.construct({
                type_: TYPE.VAL_LAST_BLK,
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
        let t_name = _.t_name(node_i);
        getColumns(t_name).then(columns => {
            let statement = `SELECT MD5(GROUP_CONCAT(${columns.map(c => `IFNULL(${c}, "NULL")`).join()})) as hash`
                + `FROM ${t_name} WHERE ${_.block_calc_sql}  = ?`;
            Database.query(statement, [block_n]).then(result => {
                if (!result.length || result[0].hash != hash) { //Hash mismatch
                    //ReSync Block
                    let clear_statement = `DELETE FROM ${t_name} WHERE `
                        + `CEIL(CAST(${H_struct.VECTOR_CLOCK} AS UNSIGNED) / (${floGlobals.sn_config.hash_n})) = ?`;
                    Database.query(clear_statement, [block_n])
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
    let t_name = _.t_name(node_i);
    ws.send(packet_.construct({
        type_: TYPE.INDICATE_BLK,
        node_i, block_n,
        status: true
    }))
    console.debug(`START: Sync-send ${node_i}#${block_n} to ${ws.id}`);
    let statement = `SELECT * FROM ${t_name} WHERE ${_.block_calc_sql} = ?`;
    Database.query_stream(statement, [block_n], d => ws.send(packet_.construct({
        type_: TYPE.STORE_BACKUP_DATA,
        data: d
    }))).then(result => console.debug(`END: Sync-send ${node_i}#${block_n} to ${ws.id} (${result} records)`))
        .catch(error => {
            console.debug(`ERROR: Sync-send ${node_i}#${block_n} to ${ws.id}`)
            console.error(error);
        }).finally(_ => ws.send(packet_.construct({
            type_: TYPE.INDICATE_BLK,
            node_i, block_n,
            status: false
        })));
}

//R: end block 
function endBlockSync(node_i, block_n) {
    queueSync.end_block(node_i, block_n);
}

function syncIndicator(node_i, block_n, status, from) {
    console.debug(`${status ? 'START' : 'END'}: Sync-receive ${node_i}#${block_n} from ${from}`);
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