global.floGlobals = require("./floGlobals");
require('./set_globals');
require('./lib');
global.cloud = require('./cloud');
global.floCrypto = require('./floCrypto');
global.floBlockchainAPI = require('./floBlockchainAPI');
const Database = require("./database");
const intra = require('./backup/intra');
const Server = require('./server');
const keys = require("./keys");
const { INTERVAL_REFRESH_TIME } = require("./_constants");

const DB = Database.DB;

function startNode() {

    const config = require(`../args/config.json`);
    let _pass;
    for (let arg of process.argv)
        if (/^-password=/i.test(arg))
            _pass = arg.split(/=(.*)/s)[1];
    try {
        let _tmp = require(`../args/keys.json`);
        _tmp = floCrypto.retrieveShamirSecret(_tmp);
        if (!_pass) {
            console.error('Password not entered!');
            process.exit(1);
        }
        keys.node_priv = Crypto.AES.decrypt(_tmp, _pass);
    } catch (error) {
        console.error('Unable to load private key!');
        process.exit(1);
    }

    console.info("Logged in as", keys.node_id);

    //DB connect
    Database.init(config["sql_user"], config["sql_pwd"], config["sql_db"], config["sql_host"]).then(db => {
        console.info("Connected to Database");
        loadBase().then(base => {
            console.log("Load Database successful");
            //Set base data from DB to floGlobals
            floGlobals.supernodes = base.supernodes;
            floGlobals.sn_config = base.sn_config;
            floGlobals.appList = base.appList;
            floGlobals.appSubAdmins = base.appSubAdmins;
            floGlobals.appTrustedIDs = base.appTrustedIDs;
            refreshData.base = base;
            refreshData.invoke(null)
                .then(_ => intra.reconnectNextNode()).catch(_ => null);
            //Start Server
            const server = new Server(config["port"]);
            server.refresher = refreshData;
            intra.refresher = refreshData;
        }).catch(error => console.error(error));
    }).catch(error => console.error(error));
};

function loadBase() {
    return new Promise((resolve, reject) => {
        DB.createBase().then(result => {
            DB.getBase()
                .then(result => resolve(result))
                .catch(error => reject(error));
        }).catch(error => reject(error));
    });
};

const refreshData = {
    count: null,
    base: null,
    refresh_instance: null,
    invoke(flag = true) {
        return new Promise((resolve, reject) => {
            const self = this;
            console.info("Refresher processor has started at " + Date());
            if (self.refresh_instance !== null) {
                clearInterval(self.refresh_instance);
                self.refresh_instance = null;
            }
            refreshBlockchainData(self.base, flag).then(result => {
                console.log(result);
                self.count = floGlobals.sn_config.refreshDelay;
                diskCleanUp(self.base)
                    .then(result => console.log(result))
                    .catch(warn => console.warn(warn))
                    .finally(_ => {
                        console.info("Refresher processor has finished at " + Date());
                        resolve(true);
                    });
            }).catch(error => {
                console.error(error);
                reject(false);
            }).finally(_ => {
                self.refresh_instance = setInterval(() => {
                    refreshBlockchainData(self.base, true)
                        .then(result => console.log(result))
                        .catch(error => console.error(error))
                }, INTERVAL_REFRESH_TIME)
            });
        });
    },
    get countdown() {
        this.count--;
        if (this.count <= 0)
            this.invoke().then(_ => null).catch(_ => null);
    }
};

function refreshBlockchainData(base, flag) {
    return new Promise((resolve, reject) => {
        readSupernodeConfigFromAPI(base, flag).then(result => {
            console.log(result);
            cloud(floGlobals.SNStorageID, Object.keys(floGlobals.supernodes));
            console.log("NodeList (ordered):", cloud.order);
            readAppSubAdminListFromAPI(base)
                .then(result => console.log(result))
                .catch(warn => console.warn(warn))
                .finally(_ => resolve("Refreshed Data from blockchain"));
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
                node_change = {},
                node_update = new Set();
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
                if (content.updateNodes)
                    for (let sn in content.updateNodes) {
                        promises.push(DB.updateSuperNode(sn, content.updateNodes[sn]));
                        base.supernodes[sn].uri = content.updateNodes[sn];
                        node_update.add(sn);
                    }
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
            });
            //Process data migration if nodes are changed
            if (Object.keys(node_change).length || node_update.size) {
                if (flag === null) {
                    if (Object.keys(node_change).length)
                        selfDiskMigration(node_change); //When node starts for the 1st time after been inactive, but migration has already taken place.
                }
                else
                    intra.dataMigration(node_change, flag);
            }

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
                ignoreOld: base.lastTx[base.appList[app]] || 0,
                sentOnly: true,
                pattern: app
            }).then(result => {
                let subAdmins = new Set(base.appSubAdmins[app]),
                    trustedIDs = new Set(base.appTrustedIDs[app]);
                result.data.reverse().forEach(data => {
                    let content = JSON.parse(data)[app];
                    if (Array.isArray(content.removeSubAdmin))
                        content.removeSubAdmin.forEach(sa => subAdmins.delete(sa));
                    if (Array.isArray(content.addSubAdmin))
                        content.addSubAdmin.forEach(sa => subAdmins.add(sa));
                    if (Array.isArray(content.removeTrustedID))
                        content.removeTrustedID.forEach(sa => trustedIDs.delete(sa));
                    if (Array.isArray(content.addTrustedID))
                        content.addTrustedID.forEach(sa => trustedIDs.add(sa));
                });
                base.appSubAdmins[app] = Array.from(subAdmins);
                base.appTrustedIDs[app] = Array.from(trustedIDs);
                Promise.allSettled([
                    DB.setLastTx(base.appList[app], result.totalTxs),
                    DB.setSubAdmin(app, base.appSubAdmins[app]),
                    DB.setTrustedIDs(app, base.appTrustedIDs[app])
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
                console.debug(error);
                reject(`subAdmin List for APPS(${Object.keys(error)}) might not have loaded correctly`);
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
                reject(`Disk clean-up process has failed at ${100 * success / results.length}%. (Success:${success}|Failed:${failed.count})`);
            } else
                resolve("Disk clean-up process finished successfully (100%)");
        }).catch(error => reject(error));
    });
};

function selfDiskMigration(node_change) {
    DB.listTable("SHOW TABLES").then(disks => {
        disks.forEach(n => {
            if (node_change[n] === false)
                DB.dropTable(n).then(_ => null).catch(e => console.error(e));
            DB.readAllDataStream(n, 0, d => {
                let closest = cloud.closestNode(d.receiverID);
                if (closest !== n)
                    DB.deleteData(n, d.vectorClock).then(_ => null).catch(e => console.error(e));
            }).then(result => console.debug(`Completed self-disk migration for ${n}`)).catch(error => console.error(error));
        });
    }).catch(error => console.error(error));
};

module.exports = startNode;