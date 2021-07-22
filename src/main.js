const config = require("../config.json");
global.floGlobals = require("./floGlobals");
require('./set_globals');
require('./lib');
require('./kBucket');
require('./floCrypto');
require('./floBlockchainAPI');
const Database = require("./database");
const intra = require('./intra');
const client = require('./client');
const Server = require('./server');

var DB; //Container for Database object

function startNode() {
    //Set myPrivKey, myPubKey, myFloID
    global.myPrivKey = config["privateKey"];
    global.myPubKey = floCrypto.getPubKeyHex(config["privateKey"]);
    global.myFloID = floCrypto.getFloID(config["privateKey"]);
    console.info("Logged In as " + myFloID);
    //DB connect
    Database(config["sql_user"], config["sql_pwd"], config["sql_db"], config["sql_host"]).then(db => {
        console.info("Connected to Database");
        DB = db;
        //Set DB to client and intra scripts
        intra.DB = DB;
        client.DB = DB;
        client._list = intra._list;
        loadBase().then(base => {
            //Set base data from DB to floGlobals
            floGlobals.supernodes = base.supernodes;
            floGlobals.sn_config = base.sn_config;
            floGlobals.appList = base.appList;
            floGlobals.appSubAdmins = base.appSubAdmins;
            refreshData.base = base;
            refreshData.invoke();
            //Start Server
            const server = new Server(config["port"], client, intra);
            server.refresher = refreshData;
            intra.refresher = refreshData;
        }).catch(error => reject(error));
    }).catch(error => reject(error));
};

function loadBase(DB) {
    return new Promise((resolve, reject) => {
        DB.createBase().then(result => {
            DB.getBase(DB)
                .then(result => resolve(result))
                .catch(error => reject(error));
        }).catch(error => reject(error));
    });
};

const refreshData = {
    count: null,
    base: null,
    invoke(flag = true) {
        this.count = floGlobals.sn_config.refreshDelay;
        refreshBlockchainData(this.base, flag).then(result => {
            console.log(result);
            diskCleanUp(this.base)
                .then(result => console.info(result))
                .catch(warn => console.warn(warn));
        }).catch(error => console.error(error));
    },
    get countdown() {
        this.count--;
        if (this.count <= 0)
            this.invoke();
    }
};

function refreshBlockchainData(base, flag) {
    return new Promise((resolve, reject) => {
        readSupernodeConfigFromAPI(base, flag).then(result => {
            console.log(result);
            kBucket.launch().then(result => {
                console.log(result);
                readAppSubAdminListFromAPI(base)
                    .then(result => console.log(result))
                    .catch(warn => console.warn(warn))
                    .finally(_ => resolve("Refreshed Data from blockchain"));
            }).catch(error => reject(error));
        }).catch(error => reject(error));
    });
};

function readSupernodeConfigFromAPI(base, flag) {
    return new Promise((resolve, reject) => {
        floBlockchainAPI.readData(floGlobals.SNStorageID, {
            ignoreOld: base.lastTx[floGlobals.SNStorageID],
            sentOnly: true,
            pattern: "SuperNodeStorage"
        }).then(result => {
            let promises = [],
                node_change = {};
            result.data.reverse().forEach(data => {
                var content = JSON.parse(data).SuperNodeStorage;
                if (content.removeNodes)
                    for (let sn of content.removeNodes) {
                        promises.push(DB.rmSuperNode(sn));
                        delete base.supernodes[sn];
                        if (node_change[sn] === true)
                            delete node_change[sn];
                        else
                            node_change[sn] = false;
                    };
                if (content.newNodes)
                    for (let sn in content.newNodes) {
                        promises.push(DB.addSuperNode(sn, content.newNodes[sn].pubKey, content.newNodes[sn].uri));
                        base.supernodes[sn] = {
                            pubKey: content.newNodes[sn].pubKey,
                            uri: content.newNodes[sn].uri
                        };
                        if (node_change[sn] === false)
                            delete node_change[sn];
                        else
                            node_change[sn] = true;
                    };
                if (content.config)
                    for (let c in content.config) {
                        promises.push(DB.setConfig(c, content.config[c]));
                        base.sn_config[c] = content.config[c];
                    };
                if (content.removeApps)
                    for (let app of content.removeApps) {
                        promises.push(DB.rmApp(app));
                        delete base.appList;
                    };
                if (content.addApps)
                    for (let app in content.addApps) {
                        promises.push(DB.addApp(app, content.addApps[app]));
                        base.appList[app] = content.addApps[app];
                    };
            });
            promises.push(DB.setLastTx(floGlobals.SNStorageID, result.totalTxs));
            //Check if all save process were successful
            Promise.allSettled(promises).then(results => {
                if (results.reduce((a, r) => r.status === "rejected" ? ++a : a, 0))
                    console.warn("Some data might not have been saved in database correctly");
                else
                    console.log("All data are saved in database");
            });
            //Process data migration if nodes are changed
            if (Object.keys(node_change))
                intra.dataMigration(node_change, flag);
            resolve('Updated Supernode Configuration');
        }).catch(error => reject(error));
    });
};

function readAppSubAdminListFromAPI(base) {
    var promises = [];
    //Load for each apps
    for (let app in base.appList) {
        promises.push(new Promise((resolve, reject) => {
            floBlockchainAPI.readData(base.appList[app], {
                ignoreOld: base.lastTx[`${app}_${base.appList[app]}`],
                sentOnly: true,
                pattern: app
            }).then(result => {
                let subAdmins = new Set(base.appSubAdmins[app]);
                result.data.reverse().forEach(data => {
                    let content = JSON.parse(result.data[i])[app];
                    if (Array.isArray(content.removeSubAdmin))
                        content.removeSubAdmin.forEach(sa => subAdmins.delete(sa));
                    if (Array.isArray(content.addSubAdmin))
                        content.addSubAdmin.forEach(sa => subAdmins.add(sa));
                });
                base.appSubAdmins[app] = Array.from(subAdmins);
                Promise.allSettled([
                    DB.setLastTx(`${app}_${base.appList[app]}`, result.totalTxs),
                    DB.setSubAdmin(app, base.appSubAdmins[app])
                ]).then(results => {
                    if (results.reduce((a, r) => r.status === "rejected" ? ++a : a, 0))
                        console.warn(`SubAdmin list for app(${app}) might not have been saved in database`);
                });
                resolve("Loaded subAdmin List for APP:" + app);
            }).catch(error => reject([app, error]));
        }));
    };
    return new Promise((resolve, reject) => {
        Promise.allSettled(promises).then(results => {
            if (results.reduce((a, r) => r.status === "rejected" ? ++a : a, 0)) {
                let error = Object.fromEntries(results.filter(r => r.status === "rejected").map(r => r.reason));
                console.error(JSON.stringify(error));
                reject(`subAdmin List for APPS(${Object.keys(error)} might not have loaded correctly`);
            } else
                resolve("Loaded subAdmin List for all APPs successfully");
        });
    });
};

function diskCleanUp(base) {
    return new Promise((resolve, reject) => {
        let time = Date.now() - base.sn_config.deleteDelay,
            promises = [];

        intra._list.serving.forEach(sn => {
            //delete all when app is not authorised.
            promises.push(DB.clearUnauthorisedAppData(sn, Object.keys(base.appList), time));
            //for each authorised app: delete unofficial data (untaged, unknown sender/receiver)
            for (let app in base.appList)
                promises.push(DB.clearAuthorisedAppData(sn, app, base.appList[app], base.subAdmins[app], time));
        });

        Promise.allSettled(promises).then(results => {
            let failed = results.filter(r => r.status === "rejected").map(r => r.reason);
            if (failed.length) {
                console.error(JSON.stringify(failed));
                let success = results.length - failed.length;
                reject(`Disk clean-up process has failed at ${100 * success/results.length}%. (Success:${success}|Failed:${failed.count})`);
            } else
                resolve("Disk clean-up process finished successfully (100%)");
        }).catch(error => reject(error));
    });
};

module.exports = startNode;