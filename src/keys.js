'use strict';

const PRIV_EKEY_MIN = 32,
    PRIV_EKEY_MAX = 48;

var node_priv, e_key, node_id, node_pub; //containers for node-key wrapper
const _x = {
    get node_priv() {
        if (!node_priv || !e_key)
            throw Error("keys not set");
        return Crypto.AES.decrypt(node_priv, e_key);
    },
    set node_priv(key) {
        node_pub = floCrypto.getPubKeyHex(key);
        node_id = floCrypto.getFloID(node_pub);
        if (!key || !node_pub || !node_id)
            throw Error("Invalid Keys");
        let n = floCrypto.randInt(PRIV_EKEY_MIN, PRIV_EKEY_MAX)
        e_key = floCrypto.randString(n);
        node_priv = Crypto.AES.encrypt(key, e_key);
    }
}

module.exports = {
    set node_priv(key) {
        _x.node_priv = key;
    },
    get node_priv() {
        return _x.node_priv;
    },
    get node_id() {
        return node_id;
    },
    get node_pub() {
        return node_pub;
    }
}