const floGlobals = {

    //Required for all
    blockchain: "FLO",

    SNStorageID: "FNaN9McoBAEFUjkRmNQRYLmBF8SpS7Tgfk",

    //Required for Supernode operations
    supernodes: {}, //each supnernode must be stored as floID : {uri:<uri>,pubKey:<publicKey>}
    appList: {},
    appSubAdmins: {},
    sn_config: {}
    /* List of supernode configurations (all blockchain controlled by SNStorageID)
    backupDepth     - (Interger) Number of backup nodes
    refreshDelay    - (Interger) Count of requests for triggering read-blockchain and autodelete
    deleteDelay     - (Interger) Maximum duration (milliseconds) an unauthorised data is stored
    errorFeedback   - (Boolean) Send error (if any) feedback to the requestor
    delayDelta      - (Interger) Maximum allowed delay from the data-time
    blockInterval   - (Interger) Duration (milliseconds) of a single block (for backup sync)
    */
};

(typeof global !== "undefined" ? global : window).cryptocoin = floGlobals.blockchain;
('object' === typeof module) ? module.exports = floGlobals : null;