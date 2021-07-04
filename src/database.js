'use strict';
var mysql = require('mysql');

(function() {
    var db = module.exports = {}

    const H_struct = {
        VECTOR_CLOCK: "vectorClock",
        SENDER_ID: "senderID",
        RECEIVER_ID: "receiverID",
        TYPE: "type",
        APPLICATION: "application"
    }

    const B_struct = {
        TIME: "time",
        MESSAGE: "message",
        SIGNATURE: "sign",
        PUB_KEY: "pubKey",
        COMMENT: "comment"
    }

    const L_struct = {
        STATUS: "status_n",
        LOG_TIME: "log_time"
    }

    const T_struct = {
        TAG: "tag",
        TAG_TIME: "tag_time",
        TAG_KEY: "tag_key",
        TAG_SIGN: "tag_sign"
    }

    db.connect = function(user, password, db, host = 'localhost') {
        return new Promise((resolve, reject) => {
            let conn = mysql.createConnection({
                host: host,
                user: user,
                password: password,
                database: db
            });
            conn.connect((err) => {
                if (err) return reject(err);
                this.conn = conn;
                resolve("Connected")
            })
        })
    }

    db.createTable = function(snID) {
        return new Promise((resolve, reject) => {
            let statement1 = "CREATE TABLE " + snID + " (" +
                H_struct.VECTOR_CLOCK + " VARCHAR(50) NOT NULL, " +
                H_struct.SENDER_ID + " CHAR(34) NOT NULL, " +
                H_struct.RECEIVER_ID + " CHAR(34) NOT NULL, " +
                H_struct.APPLICATION + " VARCHAR(128) NOT NULL, " +
                H_struct.TYPE + " VARCHAR(1024), " +
                B_struct.MESSAGE + " TEXT NOT NULL, " +
                B_struct.TIME + " INT NOT NULL, " +
                B_struct.SIGNATURE + " VARCHAR(160) NOT NULL, " +
                B_struct.PUB_KEY + " CHAR(66) NOT NULL, " +
                B_struct.COMMENT + " VARCHAR(1024), " +
                L_struct.STATUS + " INT NOT NULL, " +
                L_struct.LOG_TIME + " INT NOT NULL, " +
                T_struct.TAG + " VARCHAR (1024), " +
                T_struct.TAG_TIME + " INT, " +
                T_struct.TAG_KEY + " CHAR(66), " +
                T_struct.TAG_SIGN + " VARCHAR(160), " +
                "PRIMARY KEY (" + H_struct.VECTOR_CLOCK + ")";
            this.conn.query(statement1, (err, res) => err ? reject(err) : resolve(res));
        })
    }

    db.dropTable = function(snID) {
        return new Promise((resolve, reject) => {
            let statement = "DROP TABLE " + snID;
            this.conn.query(statement, (err, res) => err ? reject(err) : resolve(res));
        })
    }

    db.addData = function(snID, data) {
        return new Promise((resolve, reject) => {
            let attr = Object.keys(H_struct).map(a => H_struct[a]);
            let values = attr.map(a => data[a]);
            let statement = "INSERT INTO " + snID +
                " (" + attr.join(", ") + ", " + L_struct.STATUS + ", " + L_struct.LOG_TIME + ") " +
                "VALUES (" + attr.map(a => '?').join(", ") + ", 1, " + Date.now() + ")";
            this.conn.query(statement, values, (err, res) => err ? reject(err) : resolve(data));
        })
    }

    db.tagData = function(snID, vectorClock, tag, tagTime, tagKey, tagSign) {
        return new Promise((resolve, reject) => {
            let statement = "UPDATE " + snID +
                " SET " +
                T_struct.TAG + "=?, " +
                T_struct.TAG_TIME + "=?, " +
                T_struct.TAG_KEY + "=?, " +
                T_struct.TAG_SIGN + "=? " +
                L_struct.LOG_TIME + "=?"
            " WHERE " + H_struct.VECTOR_CLOCK + "=" + vectorClock;
            this.conn.query(statement, [tag, tagTime, tagKey, tagSign, Date.now()], (err, res) => err ? reject(err) : resolve(res));
        })
    }

    db.searchData = function(snID, request) {
        return new Promise((resolve, reject) => {
            let conditionArr = [];
            if (request.lowerVectorClock || request.upperVectorClock || request.atKey) {
                if (request.lowerVectorClock && request.upperVectorClock)
                    conditionArr.push(`${H_struct.VECTOR_CLOCK} BETWEEN '${request.lowerVectorClock}' AND '${request.upperVectorClock}'`);
                else if (request.atKey)
                    conditionArr.push(`${H_struct.VECTOR_CLOCK} = '${request.atKey}'`)
                else if (request.lowerVectorClock)
                    conditionArr.push(`${H_struct.VECTOR_CLOCK} >= '${request.lowerVectorClock}'`)
                else if (request.upperVectorClock)
                    conditionArr.push(`${H_struct.VECTOR_CLOCK} <= '${request.upperVectorClock}'`)
            }
            conditionArr.push(`${H_struct.APPLICATION} = '${request.application}'`);
            conditionArr.push(`${H_struct.RECEIVER_ID} = '${request.receiverID}'`)
            if (request.comment)
                conditionArr.push(`${B_struct.COMMENT} = '${request.comment}'`)
            if (request.type)
                conditionArr.push(`${H_struct.TYPE} = '${request.type}'`)
            if (request.senderID) {
                if (Array.isArray(request.senderID))
                    conditionArr.push(`${H_struct.SENDER_ID} IN ('${request.senderID.join("', '")}')`);
                else
                    conditionArr.push(`${H_struct.SENDER_ID} = '${request.senderID}'`)
            }
            console.log(conditionArr);
            let statement = "SELECT (" + Object.keys(H_struct).join(", ") + ")" +
                " FROM " + snID +
                " WHERE " + conditionArr.join(" AND ") +
                request.mostRecent ? "LIMIT 1" : (" ORDER BY " + H_struct.VECTOR_CLOCK);
            this.conn.query(statement, (err, res) => err ? reject(err) : resolve(res));
        })
    }

    db.getData = function(snID, logtime) {
        return new Promise((resolve, reject) => {
            let statement = "SELECT * FROM " + snID +
                " WHERE " + L_struct.LOG_TIME + ">=" + logtime +
                " ORDER BY " + L_struct.LOG_TIME;
            this.conn.query(statement, (err, res) => err ? reject(err) : resolve(res))
        })
    }

    db.storeData = function(snID, data) {
        return new Promise((resolve, reject) => {
            let u_attr = Object.keys(B_struct).map(a => B_struct[a])
            let attr = Object.keys(H_struct).map(a => H_struct[a]).concat(u_attr);
            let values = attr.map(a => data[a]);
            let u_values = u_attr.map(a => data[a]);
            let statement = "INSERT INTO " + snID +
                " (" + attr.join(", ") + ", " + L_struct.STATUS + ", " + L_struct.LOG_TIME + ") " +
                "VALUES (" + attr.map(a => '?').join(", ") + ", 1, " + Date.now() + ") " +
                "ON DUPLICATE KEY UPDATE " + u_attr.map(a => a + "=?").join(", ");
                this.conn.query(statement, values.concat(u_values), (err, res) => err ? reject(err) : resolve(res));
        })
    }
})()