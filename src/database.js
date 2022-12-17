'use strict';
var mysql = require('mysql');

const Base_Tables = require("./base_tables.json");
const { H_struct, B_struct, L_struct, T_struct, F_struct } = require("./data_structure.json");

var pool; //container for pool

function initConnection(user, password, dbname, host = 'localhost') {
    return new Promise((resolve, reject) => {
        pool = mysql.createPool({
            host: host,
            user: user,
            password: password,
            database: dbname
        });
        getConnection().then(conn => {
            conn.release();
            resolve(DB);
        }).catch(error => reject(error));
    });
};

const getConnection = () => new Promise((resolve, reject) => {
    pool.getConnection((error, conn) => {
        if (error)
            reject(error);
        else
            resolve(conn);
    });
});

function queryResolve(sql, values) {
    return new Promise((resolve, reject) => {
        getConnection().then(conn => {
            const fn = (err, res) => {
                conn.release();
                (err ? reject(err) : resolve(res));
            };
            if (values)
                conn.query(sql, values, fn);
            else
                conn.query(sql, fn);
        }).catch(error => reject(error));
    })
}

function queryStream(sql, value, callback) {
    return new Promise((resolve, reject) => {
        getConnection().then(conn => {
            if (!callback && value instanceof Function) {
                callback = value;
                value = undefined;
            }
            var err_flag, row_count = 0;
            (value ? conn.query(sql, values) : conn.query(sql))
                .on('error', err => err_flag = err)
                .on('result', row => {
                    row_count++;
                    conn.pause();
                    callback(row);
                    conn.resume();
                }).on('end', _ => {
                    conn.release();
                    err_flag ? reject(err_flag) : resolve(row_count);
                });
        })
    })
}

const DB = {};

/* Base Tables */

DB.createBase = function () {
    return new Promise((resolve, reject) => {
        let statements = [];
        for (let t in Base_Tables)
            statements.push("CREATE TABLE IF NOT EXISTS " + t + "( " +
                Object.keys(Base_Tables[t]).map(a => a + " " + Base_Tables[t][a]).join(", ") + " )");
        Promise.all(statements.map(s => queryResolve(s)))
            .then(result => resolve(result))
            .catch(error => reject(error));
    });
};

DB.setLastTx = function (id, n) {
    return new Promise((resolve, reject) => {
        let statement = "INSERT INTO LastTxs (ID, N) VALUES (?, ?)" +
            " ON DUPLICATE KEY UPDATE N=?";
        queryResolve(statement, [id, n, n])
            .then(result => resolve(result))
            .catch(error => reject(error));
    });
};

DB.setConfig = function (name, value) {
    return new Promise((resolve, reject) => {
        value = JSON.stringify(value);
        let statement = "INSERT INTO Configs (NAME, VAL) VALUES (?, ?)" +
            " ON DUPLICATE KEY UPDATE VAL=?";
        queryResolve(statement, [name, value, value])
            .then(result => resolve(result))
            .catch(error => reject(error));
    });
};

DB.addSuperNode = function (id, pubKey, uri) {
    return new Promise((resolve, reject) => {
        let statement = "INSERT INTO SuperNodes (FLO_ID, PUB_KEY, URI) VALUES (?, ?, ?)" +
            " ON DUPLICATE KEY UPDATE URI=?";
        queryResolve(statement, [id, pubKey, uri, uri])
            .then(result => resolve(result))
            .catch(error => reject(error));
    });
};

DB.rmSuperNode = function (id) {
    return new Promise((resolve, reject) => {
        let statement = "DELETE FROM SuperNodes" +
            " WHERE FLO_ID=?";
        queryResolve(statement, id)
            .then(result => resolve(result))
            .catch(error => reject(error));
    });
};

DB.updateSuperNode = function (id, uri) {
    return new Promise((resolve, reject) => {
        let statement = "UPDATE SuperNodes SET URI=? WHERE FLO_ID=?";
        queryResolve(statement, [uri, id])
            .then(result => resolve(result))
            .catch(error => reject(error));
    })
}

DB.setSubAdmin = function (appName, subAdmins) {
    return new Promise((resolve, reject) => {
        let statement = "UPDATE Applications" +
            " SET SUB_ADMINS=?" +
            " WHERE APP_NAME=?";
        queryResolve(statement, [subAdmins.join(","), appName])
            .then(result => resolve(result))
            .catch(error => reject(error));
    });
};

DB.setTrustedIDs = function (appName, trustedIDs) {
    return new Promise((resolve, reject) => {
        let statement = "UPDATE Applications" +
            " SET TRUSTED_IDS=?" +
            " WHERE APP_NAME=?";
        queryResolve(statement, [trustedIDs.join(","), appName])
            .then(result => resolve(result))
            .catch(error => reject(error));
    });
}

DB.addApp = function (appName, adminID) {
    return new Promise((resolve, reject) => {
        let statement = "INSERT INTO Applications (APP_NAME, ADMIN_ID) VALUES (?, ?)" +
            " ON DUPLICATE KEY UPDATE ADMIN_ID=?";
        queryResolve(statement, [appName, adminID, adminID])
            .then(result => resolve(result))
            .catch(error => reject(error));
    });
};

DB.rmApp = function (appName) {
    return new Promise((resolve, reject) => {
        let statement = "DELETE FROM Applications" +
            " WHERE APP_NAME=" + appName;
        queryResolve(statement)
            .then(result => resolve(result))
            .catch(error => reject(error));
    });
};

DB.getBase = function () {
    return new Promise((resolve, reject) => {
        let tables = Object.keys(Base_Tables);
        Promise.all(tables.map(t => queryResolve("SELECT * FROM " + t))).then(result => {
            let tmp = Object.fromEntries(tables.map((t, i) => [t, result[i]]));
            result = {};
            result.lastTx = Object.fromEntries(tmp.LastTxs.map(a => [a.ID, a.N]));
            result.sn_config = Object.fromEntries(tmp.Configs.map(a => [a.NAME, JSON.parse(a.VAL)]));
            result.appList = Object.fromEntries(tmp.Applications.map(a => [a.APP_NAME, a.ADMIN_ID]));
            result.appSubAdmins = Object.fromEntries(tmp.Applications.map(a => [a.APP_NAME, a.SUB_ADMINS ? a.SUB_ADMINS.split(",") : []]));
            result.appTrustedIDs = Object.fromEntries(tmp.Applications.map(a => [a.APP_NAME, a.TRUSTED_IDS ? a.TRUSTED_IDS.split(",") : []]));
            result.supernodes = Object.fromEntries(tmp.SuperNodes.map(a => [a.FLO_ID, {
                pubKey: a.PUB_KEY,
                uri: a.URI
            }]));
            resolve(result);
        }).catch(error => reject(error));
    });
};


/* Supernode Tables */

DB.createTable = function (snID) {
    return new Promise((resolve, reject) => {
        let statement = "CREATE TABLE IF NOT EXISTS _" + snID + " ( " +
            H_struct.VECTOR_CLOCK + " VARCHAR(88) NOT NULL, " +
            H_struct.SENDER_ID + " VARCHAR(72) NOT NULL, " +
            H_struct.RECEIVER_ID + " VARCHAR(72) NOT NULL, " +
            H_struct.APPLICATION + " TINYTEXT NOT NULL, " +
            H_struct.TYPE + " TINYTEXT, " +
            B_struct.MESSAGE + " LONGTEXT NOT NULL, " +
            H_struct.TIME + " BIGINT NOT NULL, " +
            B_struct.SIGNATURE + " VARCHAR(160) NOT NULL, " +
            H_struct.PUB_KEY + " CHAR(66) NOT NULL, " +
            B_struct.COMMENT + " TINYTEXT, " +
            L_struct.PROXY_ID + " CHAR(34), " +
            L_struct.STATUS + " INT NOT NULL, " +
            L_struct.LOG_TIME + " BIGINT NOT NULL, " +
            T_struct.TAG + " TINYTEXT, " +
            T_struct.TAG_TIME + " BIGINT, " +
            T_struct.TAG_KEY + " CHAR(66), " +
            T_struct.TAG_SIGN + " VARCHAR(160), " +
            F_struct.NOTE + " TINYTEXT, " +
            F_struct.NOTE_TIME + " BIGINT, " +
            F_struct.NOTE_KEY + " CHAR(66), " +
            F_struct.NOTE_SIGN + " VARCHAR(160), " +
            "PRIMARY KEY (" + H_struct.VECTOR_CLOCK + ")" +
            " )";
        queryResolve(statement)
            .then(result => resolve(result))
            .catch(error => reject(error));
    });
};

DB.dropTable = function (snID) {
    return new Promise((resolve, reject) => {
        let statement = "DROP TABLE _" + snID;
        queryResolve(statement)
            .then(result => resolve(result))
            .catch(error => reject(error));
    });
};

DB.listTable = function () {
    return new Promise((resolve, reject) => {
        queryResolve("SHOW TABLES").then(result => {
            const disks = [];
            for (let i in result)
                for (let j in result[i])
                    if (result[i][j].startsWith("_"))
                        disks.push(result[i][j].split("_")[1]);
            resolve(disks);
        }).catch(error => reject(error))
    })
}

/* Data Service (by client)*/

DB.addData = function (snID, data) {
    return new Promise((resolve, reject) => {
        data[L_struct.STATUS] = 1;
        data[L_struct.LOG_TIME] = Date.now();
        let proxyID = cloud.proxyID(data[H_struct.RECEIVER_ID]);
        data[L_struct.PROXY_ID] = proxyID !== data[H_struct.RECEIVER_ID] ? proxyID : null;
        let attr = Object.keys(H_struct).map(a => H_struct[a])
            .concat(Object.keys(B_struct).map(a => B_struct[a]))
            .concat(Object.keys(L_struct).map(a => L_struct[a]));
        let values = attr.map(a => data[a]);
        let statement = "INSERT INTO _" + snID +
            " (" + attr.join(", ") + ") " +
            "VALUES (" + attr.map(a => '?').join(", ") + ")";
        data = Object.fromEntries(attr.map((a, i) => [a, values[i]]));
        queryResolve(statement, values)
            .then(result => resolve(data))
            .catch(error => reject(error));
    });
};

DB.getData = function (snID, vectorClock) {
    return new Promise((resolve, reject) => {
        let statement = "SELECT * FROM _" + snID +
            " WHERE " + H_struct.VECTOR_CLOCK + "=?";
        queryResolve(statement, [vectorClock])
            .then(result => resolve(result))
            .catch(error => reject(error))
    })
};

DB.tagData = function (snID, vectorClock, tag, tagTime, tagKey, tagSign) {
    return new Promise((resolve, reject) => {
        let data = {
            [T_struct.TAG]: tag,
            [T_struct.TAG_TIME]: tagTime,
            [T_struct.TAG_KEY]: tagKey,
            [T_struct.TAG_SIGN]: tagSign,
            [L_struct.LOG_TIME]: Date.now()
        };
        let attr = Object.keys(data);
        let values = attr.map(a => data[a]).concat(vectorClock);
        data[H_struct.VECTOR_CLOCK] = vectorClock; //also add vectorClock to resolve data
        let statement = "UPDATE _" + snID +
            " SET " + attr.map(a => a + "=?").join(", ") +
            " WHERE " + H_struct.VECTOR_CLOCK + "=?";
        queryResolve(statement, values)
            .then(result => resolve(data))
            .catch(error => reject(error));
    });
};

DB.noteData = function (snID, vectorClock, note, noteTime, noteKey, noteSign) {
    return new Promise((resolve, reject) => {
        let data = {
            [F_struct.NOTE]: note,
            [F_struct.NOTE_TIME]: noteTime,
            [F_struct.NOTE_KEY]: noteKey,
            [F_struct.NOTE_SIGN]: noteSign,
            [L_struct.LOG_TIME]: Date.now()
        };
        let attr = Object.keys(data);
        let values = attr.map(a => data[a]).concat(vectorClock);
        data[H_struct.VECTOR_CLOCK] = vectorClock; //also add vectorClock to resolve data
        let statement = "UPDATE _" + snID +
            " SET " + attr.map(a => a + "=?").join(", ") +
            " WHERE " + H_struct.VECTOR_CLOCK + "=?";
        queryResolve(statement, values)
            .then(result => resolve(data))
            .catch(error => reject(error));
    });
}

DB.searchData = function (snID, request) {
    return new Promise((resolve, reject) => {
        let conditionArr = [];
        if (request.lowerVectorClock || request.upperVectorClock || request.atVectorClock) {
            if (request.atVectorClock)
                conditionArr.push(`${H_struct.VECTOR_CLOCK} = '${request.atVectorClock}'`);
            else if (request.lowerVectorClock && request.upperVectorClock)
                conditionArr.push(`${H_struct.VECTOR_CLOCK} BETWEEN '${request.lowerVectorClock}' AND '${request.upperVectorClock}'`);
            else if (request.lowerVectorClock)
                conditionArr.push(`${H_struct.VECTOR_CLOCK} >= '${request.lowerVectorClock}'`);
            else if (request.upperVectorClock)
                conditionArr.push(`${H_struct.VECTOR_CLOCK} <= '${request.upperVectorClock}'`);
        }
        if (request.afterTime)
            conditionArr.push(`${L_struct.LOG_TIME} > ${request.afterTime}`);
        conditionArr.push(`${H_struct.APPLICATION} = '${request.application}'`);
        conditionArr.push(`IFNULL(${L_struct.PROXY_ID}, ${H_struct.RECEIVER_ID}) = '${cloud.proxyID(request.receiverID)}'`);
        if (request.comment)
            conditionArr.push(`${B_struct.COMMENT} = '${request.comment}'`);
        if (request.type)
            conditionArr.push(`${H_struct.TYPE} = '${request.type}'`);
        if (request.senderID) {
            if (typeof request.senderID === "string" && request.senderID.includes(','))
                request.senderID = request.senderID.split(',');
            if (Array.isArray(request.senderID))
                conditionArr.push(`${H_struct.SENDER_ID} IN ('${request.senderID.join("', '")}')`);
            else
                conditionArr.push(`${H_struct.SENDER_ID} = '${request.senderID}'`);
        };
        //console.log(conditionArr);
        //let attr = Object.keys(H_struct).map(a => H_struct[a]).concat(Object.keys(B_struct).map(a => B_struct[a]));
        //let statement = "SELECT " + attr.join(", ") + " FROM _" + snID +
        let statement = "SELECT * FROM _" + snID +
            " WHERE " + conditionArr.join(" AND ") +
            " ORDER BY " + (request.afterTime ? L_struct.LOG_TIME : H_struct.VECTOR_CLOCK) +
            (request.mostRecent ? " DESC LIMIT 1" : "");
        queryResolve(statement)
            .then(result => resolve(result))
            .catch(error => reject(error));
    });
};

/* Backup service */

DB.lastLogTime = function (snID) {
    return new Promise((resolve, reject) => {
        let attr = "MAX(" + L_struct.LOG_TIME + ")";
        let statement = "SELECT " + attr + " FROM _" + snID;
        queryResolve(statement)
            .then(result => resolve(result[0][attr] || 0))
            .catch(error => reject(error));
    });
};

DB.createGetLastLog = function (snID) {
    return new Promise((resolve, reject) => {
        DB.createTable(snID).then(result => {
            DB.lastLogTime(snID)
                .then(result => resolve(result))
                .catch(error => reject(error));
        }).catch(error => reject(error));
    });
};

DB.readAllDataStream = function (snID, logtime, callback) {
    return new Promise((resolve, reject) => {
        let statement = "SELECT * FROM _" + snID +
            " WHERE " + L_struct.LOG_TIME + ">" + logtime +
            " ORDER BY " + L_struct.LOG_TIME;
        queryStream(statement, callback)
            .then(result => resolve(result))
            .catch(error => reject(error));
    });
};

DB.storeData = function (snID, data, updateLogTime = false) {
    return new Promise((resolve, reject) => {
        if (updateLogTime)
            data[L_struct.LOG_TIME] = Date.now();
        let u_attr = Object.keys(B_struct).map(a => B_struct[a])
            .concat(Object.keys(L_struct).map(a => L_struct[a]))
            .concat(Object.keys(T_struct).map(a => T_struct[a]));
        let attr = Object.keys(H_struct).map(a => H_struct[a]).concat(u_attr);
        let values = attr.map(a => data[a]);
        let u_values = u_attr.map(a => data[a]);
        let statement = "INSERT INTO _" + snID +
            " (" + attr.join(", ") + ") " +
            "VALUES (" + attr.map(a => '?').join(", ") + ") " +
            "ON DUPLICATE KEY UPDATE " + u_attr.map(a => a + "=?").join(", ");
        queryResolve(statement, values.concat(u_values))
            .then(result => resolve(data))
            .catch(error => reject(error));
    });
};

DB.storeTag = function (snID, data) {
    return new Promise((resolve, reject) => {
        let attr = Object.keys(T_struct).map(a => T_struct[a]).concat(L_struct.LOG_TIME);
        let values = attr.map(a => data[a]).concat(data[H_struct.VECTOR_CLOCK]);
        let statement = "UPDATE _" + snID +
            " SET " + attr.map(a => a + "=?").join(", ") +
            " WHERE " + H_struct.VECTOR_CLOCK + "=?";
        queryResolve(statement, values)
            .then(result => resolve(data))
            .catch(error => reject(error));
    });
};

DB.storeNote = function (snID, data) {
    let attr = Object.keys(F_struct).map(a => F_struct[a]).concat(L_struct.LOG_TIME);
    let values = attr.map(a => data[a]).concat(data[H_struct.VECTOR_CLOCK]);
    let statement = "UPDATE _" + snID +
        " SET " + attr.map(a => a + "=?").join(", ") +
        " WHERE " + H_struct.VECTOR_CLOCK + "=?";
    queryResolve(statement, values)
        .then(result => resolve(data))
        .catch(error => reject(error));
}

DB.deleteData = function (snID, vectorClock) {
    return new Promise((resolve, reject) => {
        let statement = "DELETE FROM _" + snID +
            " WHERE " + H_struct.VECTOR_CLOCK + "=?";
        queryResolve(statement, [vectorClock])
            .then(result => resolve(result))
            .catch(error => reject(error));
    });
};

/* Data clearing */

DB.clearAuthorisedAppData = function (snID, app, adminID, subAdmins, timestamp) {
    return new Promise((resolve, reject) => {
        let statement = "DELETE FROM _" + snID +
            " WHERE ( " + H_struct.TIME + "<? AND " +
            H_struct.APPLICATION + "=? AND " +
            T_struct.TAG + " IS NULL )" +
            (subAdmins.length ? " AND ( " +
                H_struct.RECEIVER_ID + " != ? OR " +
                H_struct.SENDER_ID + " NOT IN (" + subAdmins.map(a => "?").join(", ") + ") )" :
                "");
        queryResolve(statement, [timestamp, app, adminID].concat(subAdmins))
            .then(result => resolve(result))
            .catch(error => reject(error));
    });
};

DB.clearUnauthorisedAppData = function (snID, appList, timestamp) {
    return new Promise((resolve, reject) => {
        let statement = "DELETE FROM _" + snID +
            " WHERE " + H_struct.TIME + "<?" +
            (appList.length ? " AND " +
                H_struct.APPLICATION + " NOT IN (" + appList.map(a => "?").join(", ") + ")" :
                "");
        queryResolve(statement, [timestamp].concat(appList))
            .then(result => resolve(result))
            .catch(error => reject(error));
    });
};

module.exports = {
    init: initConnection,
    query: queryResolve,
    query_stream: queryStream,
    DB
};