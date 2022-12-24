'use strict';
const Database = require('../src/database');

function CheckDB() {
    return new Promise((resolve, reject) => {
        const config = require(`../args/config.json`);
        Database.init(config["sql_user"], config["sql_pwd"], config["sql_db"], config["sql_host"]).then(result => {
            let ds = require("../src/data_structure.json");
            let cols = [];
            for (let s in ds)
                for (let c in ds[s])
                    cols.push(ds[s][c]);
            let crc_ = "SUM(" + cols.map(c => `IFNULL(CRC32(${c}), 0)`).join('+') + ")";
            Database.DB.listTable().then(disks => {
                let promises = disks.map(d => Database.query(`SELECT ? AS disk, COUNT(*) AS total_rec, ${crc_} AS crc_checksum FROM _${d}`, d));
                Promise.allSettled(promises).then(results => {
                    let records = results.filter(r => r.status === "fulfilled").map(r => r.value[0]);
                    console.table(records);
                    let errors = results.filter(r => r.status === "rejected");
                    if (errors.length)
                        console.error(errors.map(r => r.reason));
                    resolve(true);
                })
            }).catch(error => reject(error));
        }).catch(error => reject(error));
    })
}

CheckDB().then(_ => process.exit(0)).catch(error => { console.error(error); process.exit(1); })