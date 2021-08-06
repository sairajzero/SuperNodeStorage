'use strict';
var mysql = require('mysql');

const Base_Tables = {
    LastTxs: {
        ID: "CHAR(34) NOT NULL",
        N: "INT NOT NULL",
        PRIMARY: "KEY (ID)"
    },
    Configs: {
        NAME: "VARCHAR(64) NOT NULL",
        VAL: "VARCHAR(512) NOT NULL",
        PRIMARY: "KEY (NAME)"
    },
    SuperNodes: {
        FLO_ID: "CHAR(34) NOT NULL",
        PUB_KEY: "CHAR(66) NOT NULL",
        URI: "VARCHAR(256) NOT NULL",
        PRIMARY: "KEY (FLO_ID)"
    },
    Applications: {
        APP_NAME: "VARCHAR(64) NOT NULL",
        ADMIN_ID: "CHAR(34) NOT NULL",
        SUB_ADMINS: "VARCHAR(3500)",
        PRIMARY: "KEY (APP_NAME)"
    }
};

const H_struct = {
    VECTOR_CLOCK: "vectorClock",
    SENDER_ID: "senderID",
    RECEIVER_ID: "receiverID",
    TYPE: "type",
    APPLICATION: "application",
    TIME: "time",
    PUB_KEY: "pubKey"
};

const B_struct = {
    MESSAGE: "message",
    SIGNATURE: "sign",
    COMMENT: "comment"
};

const L_struct = {
    STATUS: "status_n",
    LOG_TIME: "log_time"
};

const T_struct = {
    TAG: "tag",
    TAG_TIME: "tag_time",
    TAG_KEY: "tag_key",
    TAG_SIGN: "tag_sign"
};

function Database(user, password, dbname, host = 'localhost') {
    const db = {};

    db.createBase = function() {
        return new Promise((resolve, reject) => {
            let statements = [];
            for (let t in Base_Tables)
                statements.push("CREATE TABLE IF NOT EXISTS " + t + "( " +
                    Object.keys(Base_Tables[t]).map(a => a + " " + Base_Tables[t][a]).join(", ") + " )");
            Promise.all(statements.map(s => db.query(s)))
                .then(result => resolve(result))
                .catch(error => reject(error));
        });
    };

    db.setLastTx = function(id, n) {
        return new Promise((resolve, reject) => {
            let statement = "INSERT INTO LastTxs (ID, N) VALUES (?, ?)" +
                " ON DUPLICATE KEY UPDATE N=?";
            db.query(statement, [id, n, n])
                .then(result => resolve(result))
                .catch(error => reject(error));
        });
    };

    db.setConfig = function(name, value) {
        return new Promise((resolve, reject) => {
            let statement = "INSERT INTO Configs (NAME, VAL) VALUES (?, ?)" +
                " ON DUPLICATE KEY UPDATE VAL=?";
            db.query(statement, [name, value, value])
                .then(result => resolve(result))
                .catch(error => reject(error));
        });
    };

    db.addSuperNode = function(id, pubKey, uri) {
        return new Promise((resolve, reject) => {
            let statement = "INSERT INTO SuperNodes (FLO_ID, PUB_KEY, URI) VALUES (?, ?, ?)" +
                " ON DUPLICATE KEY UPDATE URI=?";
            db.query(statement, [id, pubKey, uri, uri])
                .then(result => resolve(result))
                .catch(error => reject(error));
        });
    };

    db.rmSuperNode = function(id) {
        return new Promise((resolve, reject) => {
            let statement = "DELETE FROM SuperNodes" +
                " WHERE FLO_ID=?";
            db.query(statement, id)
                .then(result => resolve(result))
                .catch(error => reject(error));
        });
    };

    db.setSubAdmin = function(appName, subAdmins) {
        return new Promise((resolve, reject) => {
            let statement = "UPDATE Applications" +
                " SET SUB_ADMINS=?" +
                " WHERE APP_NAME=?";
            db.query(statement, [subAdmins.join(","), appName])
                .then(result => resolve(result))
                .catch(error => reject(error));
        });
    };

    db.addApp = function(appName, adminID) {
        return new Promise((resolve, reject) => {
            let statement = "INSERT INTO Applications (APP_NAME, ADMIN_ID) VALUES (?, ?)" +
                " ON DUPLICATE KEY UPDATE ADMIN_ID=?";
            db.query(statement, [appName, adminID, adminID])
                .then(result => resolve(result))
                .catch(error => reject(error));
        });
    };

    db.rmApp = function(appName) {
        return new Promise((resolve, reject) => {
            let statement = "DELETE FROM Applications" +
                " WHERE APP_NAME=" + appName;
            db.query(statement)
                .then(result => resolve(result))
                .catch(error => reject(error));
        });
    };

    db.getBase = function() {
        return new Promise((resolve, reject) => {
            let tables = Object.keys(Base_Tables);
            Promise.all(tables.map(t => db.query("SELECT * FROM " + t))).then(result => {
                let tmp = Object.fromEntries(tables.map((t, i) => [t, result[i]]));
                result = {};
                result.lastTx = Object.fromEntries(tmp.LastTxs.map(a => [a.ID, a.N]));
                result.sn_config = Object.fromEntries(tmp.Configs.map(a => [a.NAME, a.VAL]));
                result.appList = Object.fromEntries(tmp.Applications.map(a => [a.APP_NAME, a.ADMIN_ID]));
                result.appSubAdmins = Object.fromEntries(tmp.Applications.map(a => [a.APP_NAME, a.SUB_ADMINS.split(",")]));
                result.supernodes = Object.fromEntries(tmp.SuperNodes.map(a => [a.FLO_ID, {
                    pubKey: a.PUB_KEY,
                    uri: a.URI
                }]));
                resolve(result);
            }).catch(error => reject(error));
        });
    };

    db.createTable = function(snID) {
        return new Promise((resolve, reject) => {
            let statement = "CREATE TABLE IF NOT EXISTS _" + snID + " ( " +
                H_struct.VECTOR_CLOCK + " VARCHAR(52) NOT NULL, " +
                H_struct.SENDER_ID + " CHAR(34) NOT NULL, " +
                H_struct.RECEIVER_ID + " CHAR(34) NOT NULL, " +
                H_struct.APPLICATION + " TINYTEXT NOT NULL, " +
                H_struct.TYPE + " TINYTEXT, " +
                B_struct.MESSAGE + " TEXT NOT NULL, " +
                H_struct.TIME + " BIGINT NOT NULL, " +
                B_struct.SIGNATURE + " VARCHAR(160) NOT NULL, " +
                H_struct.PUB_KEY + " CHAR(66) NOT NULL, " +
                B_struct.COMMENT + " TINYTEXT, " +
                L_struct.STATUS + " INT NOT NULL, " +
                L_struct.LOG_TIME + " BIGINT NOT NULL, " +
                T_struct.TAG + " TINYTEXT, " +
                T_struct.TAG_TIME + " BIGINT, " +
                T_struct.TAG_KEY + " CHAR(66), " +
                T_struct.TAG_SIGN + " VARCHAR(160), " +
                "PRIMARY KEY (" + H_struct.VECTOR_CLOCK + ")" +
                " )";
            db.query(statement)
                .then(result => resolve(result))
                .catch(error => reject(error));
        });
    };

    db.dropTable = function(snID) {
        return new Promise((resolve, reject) => {
            let statement = "DROP TABLE _" + snID;
            db.query(statement)
                .then(result => resolve(result))
                .catch(error => reject(error));
        });
    };

    db.addData = function(snID, data) {
        return new Promise((resolve, reject) => {
            data[L_struct.STATUS] = 1;
            data[L_struct.LOG_TIME] = Date.now();
            let attr = Object.keys(H_struct).map(a => H_struct[a])
                .concat(Object.keys(B_struct).map(a => B_struct[a]))
                .concat(Object.keys(L_struct).map(a => L_struct[a]));
            let values = attr.map(a => data[a]);
            let statement = "INSERT INTO _" + snID +
                " (" + attr.join(", ") + ") " +
                "VALUES (" + attr.map(a => '?').join(", ") + ")";
            data = Object.fromEntries(attr.map((a, i) => [a, values[i]]));
            db.query(statement, values)
                .then(result => resolve(data))
                .catch(error => reject(error));
        });
    };

    db.tagData = function(snID, vectorClock, tag, tagTime, tagKey, tagSign) {
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
            db.query(statement, values)
                .then(result => resolve(data))
                .catch(error => reject(error));
        });
    };

    db.searchData = function(snID, request) {
        return new Promise((resolve, reject) => {
            let conditionArr = [];
            if (request.lowerVectorClock || request.upperVectorClock || request.atKey) {
                if (request.lowerVectorClock && request.upperVectorClock)
                    conditionArr.push(`${H_struct.VECTOR_CLOCK} BETWEEN '${request.lowerVectorClock}' AND '${request.upperVectorClock}'`);
                else if (request.atKey)
                    conditionArr.push(`${H_struct.VECTOR_CLOCK} = '${request.atKey}'`);
                else if (request.lowerVectorClock)
                    conditionArr.push(`${H_struct.VECTOR_CLOCK} >= '${request.lowerVectorClock}'`);
                else if (request.upperVectorClock)
                    conditionArr.push(`${H_struct.VECTOR_CLOCK} <= '${request.upperVectorClock}'`);
            }
            conditionArr.push(`${H_struct.APPLICATION} = '${request.application}'`);
            conditionArr.push(`${H_struct.RECEIVER_ID} = '${request.receiverID}'`)
            if (request.comment)
                conditionArr.push(`${B_struct.COMMENT} = '${request.comment}'`);
            if (request.type)
                conditionArr.push(`${H_struct.TYPE} = '${request.type}'`);
            if (request.senderID) {
                if (Array.isArray(request.senderID))
                    conditionArr.push(`${H_struct.SENDER_ID} IN ('${request.senderID.join("', '")}')`);
                else
                    conditionArr.push(`${H_struct.SENDER_ID} = '${request.senderID}'`);
            };
            //console.log(conditionArr);
            let attr = Object.keys(H_struct).map(a => H_struct[a]).concat(Object.keys(B_struct).map(a => B_struct[a]));
            let statement = "SELECT " + attr.join(", ") +
                " FROM _" + snID +
                " WHERE " + conditionArr.join(" AND ") +
                (request.mostRecent ? " LIMIT 1" : (" ORDER BY " + H_struct.VECTOR_CLOCK));
            db.query(statement)
                .then(result => resolve(result))
                .catch(error => reject(error));
        });
    };

    db.lastLogTime = function(snID) {
        return new Promise((resolve, reject) => {
            let attr = "MAX(" + L_struct.LOG_TIME + ")";
            let statement = "SELECT " + attr + " FROM _" + snID;
            db.query(statement)
                .then(result => resolve(result[0][attr] || 0))
                .catch(error => reject(error));
        });
    };

    db.createGetLastLog = function(snID) {
        return new Promise((resolve, reject) => {
            db.createTable(snID).then(result => {
                db.lastLogTime(snID)
                    .then(result => resolve(result))
                    .catch(error => reject(error));
            }).catch(error => reject(error));
        });
    };

    db.getData = function(snID, logtime) {
        return new Promise((resolve, reject) => {
            let statement = "SELECT * FROM _" + snID +
                " WHERE " + L_struct.LOG_TIME + ">" + logtime +
                " ORDER BY " + L_struct.LOG_TIME;
            db.query(statement)
                .then(result => resolve(result))
                .catch(error => reject(error));
        });
    };

    db.storeData = function(snID, data, updateLogTime = false) {
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
            db.query(statement, values.concat(u_values))
                .then(result => resolve(data))
                .catch(error => reject(error));
        });
    };

    db.storeTag = function(snID, data) {
        return new Promise((resolve, reject) => {
            let attr = Object.keys(T_struct).map(a => T_struct[a]).concat(L_struct.LOG_TIME);
            let values = attr.map(a => data[a]);
            let statement = "UPDATE _" + snID +
                " SET " + attr.map(a => a + "=?").join(", ") +
                " WHERE " + H_struct.VECTOR_CLOCK + "=" + data[H_struct.VECTOR_CLOCK];
            db.query(statement, values)
                .then(result => resolve(data))
                .catch(error => reject(error));
        });
    };

    db.deleteData = function(snID, vectorClock) {
        return new Promise((resolve, reject) => {
            let statement = "DELETE FROM _" + snID +
                " WHERE " + H_struct.VECTOR_CLOCK + "=?";
            db.query(statement, [vectorClock])
                .then(result => resolve(result))
                .catch(error => reject(error));
        });
    };

    db.clearAuthorisedAppData = function(snID, app, adminID, subAdmins, timestamp) {
        return new Promise((resolve, reject) => {
            let statement = "DELETE FROM _" + snID +
                " WHERE ( " + H_struct.TIME + "<? AND " +
                H_struct.APPLICATION + "=? AND " +
                T_struct.TAG + " IS NULL )" +
                (subAdmins.length ? " AND ( " +
                    H_struct.RECEIVER_ID + " != ? OR " +
                    H_struct.SENDER_ID + " NOT IN (" + subAdmins.map(a => "?").join(", ") + ") )" :
                    "");
            db.query(statement, [timestamp, app].concat(subAdmins).push(adminID))
                .then(result => resolve(result))
                .catch(error => reject(error));
        });
    };

    db.clearUnauthorisedAppData = function(snID, appList, timestamp) {
        return new Promise((resolve, reject) => {
            let statement = "DELETE FROM _" + snID +
                " WHERE " + H_struct.TIME + "<?" +
                (appList.length ? " AND " +
                    H_struct.APPLICATION + " NOT IN (" + appList.map(a => "?").join(", ") + ")" :
                    "");
            db.query(statement, [timestamp].concat(appList))
                .then(result => resolve(result))
                .catch(error => reject(error));
        });
    };

    Object.defineProperty(db, "connect", {
        get: () => new Promise((resolve, reject) => {
            db.pool.getConnection((error, conn) => {
                if (error)
                    reject(error);
                else
                    resolve(conn);
            });
        })
    });

    Object.defineProperty(db, "query", {
        value: (sql, values) => new Promise((resolve, reject) => {
            db.connect.then(conn => {
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
    });

    return new Promise((resolve, reject) => {
        db.pool = mysql.createPool({
            host: host,
            user: user,
            password: password,
            database: dbname
        });
        db.connect.then(conn => {
            conn.release();
            resolve(db);
        }).catch(error => reject(error));
    });
};

module.exports = Database;