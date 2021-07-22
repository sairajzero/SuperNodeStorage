const floGlobals = {

    //Required for all
    blockchain: "FLO",

    //Required for blockchain API operators
    apiURL: {
        FLO: ['https://explorer.mediciland.com/', 'https://livenet.flocha.in/', 'https://flosight.duckdns.org/', 'http://livenet-explorer.floexperiments.com'],
        FLO_TEST: ['https://testnet-flosight.duckdns.org', 'https://testnet.flocha.in/']
    },
    SNStorageID: "FNaN9McoBAEFUjkRmNQRYLmBF8SpS7Tgfk",
    //sendAmt: 0.001,
    //fee: 0.0005,

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
    */
};

(typeof global !== "undefined" ? global : window).cryptocoin = floGlobals.blockchain;
('object' === typeof module) ? module.export = floGlobals : null;