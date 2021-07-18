'use strict';
require('./lib/BuildKBucket')
(function(GLOBAL) {
    var kBucket = GLOBAL.kBucket = {}
    var SNKB, SNCO;

    function decodeID(floID) {
        let k = bitjs.Base58.decode(floID)
        k.shift()
        k.splice(-4, 4)
        const decodedId = Crypto.util.bytesToHex(k);
        const nodeIdBigInt = new BigInteger(decodedId, 16);
        const nodeIdBytes = nodeIdBigInt.toByteArrayUnsigned();
        const nodeIdNewInt8Array = new Uint8Array(nodeIdBytes);
        return nodeIdNewInt8Array;
    }

    function distanceOf(floID) {
        let decodedId = decodeID(floID);
        return SNKB.distance(SNKB.localNodeId, decodedId);
    }

    function constructKB(list, refID) {
        let KB = new BuildKBucket({
            localNodeId: decodeID(refID)
        });
        list.forEach(id => KB.add({
            id: decodeID(id),
            floID: floID
        }));
        return KB;
    }

    kBucket.launch = function() {
        return new Promise((resolve, reject) => {
            try {
                let superNodeList = Object.keys(floGlobals.supernodes);
                let masterID = floGlobals.SNStorageID;
                SNKB = constructKB(superNodeList, masterID);
                SNCO = superNodeList.map(sn => [distanceOf(sn), sn])
                    .sort((a, b) => a[0] - b[0])
                    .map(a => a[1])
                resolve('SuperNode KBucket formed');
            } catch (error) {
                reject(error);
            }
        });
    }

    kBucket.innerNodes = function(id1, id2) {
        if (!SNCO.includes(id1) || !SNCO.includes(id2))
            throw Error('Given nodes are not supernode');
        let iNodes = []
        for (let i = SNCO.indexOf(id1) + 1; SNCO[i] != id2; i++) {
            if (i < SNCO.length)
                iNodes.push(SNCO[i])
            else i = -1
        }
        return iNodes
    }

    kBucket.outterNodes = function(id1, id2) {
        if (!SNCO.includes(id1) || !SNCO.includes(id2))
            throw Error('Given nodes are not supernode');
        let oNodes = []
        for (let i = SNCO.indexOf(id2) + 1; SNCO[i] != id1; i++) {
            if (i < SNCO.length)
                oNodes.push(SNCO[i])
            else i = -1
        }
        return oNodes
    }

    kBucket.prevNode = function(id, N = 1) {
        let n = N || SNCO.length;
        if (!SNCO.includes(id))
            throw Error('Given node is not supernode');
        let pNodes = []
        for (let i = 0, j = SNCO.indexOf(id) - 1; i < n; j--) {
            if (j == SNCO.indexOf(id))
                break;
            else if (j > -1)
                pNodes[i++] = SNCO[j]
            else j = SNCO.length
        }
        return (N == 1 ? pNodes[0] : pNodes)
    }

    kBucket.nextNode = function(id, N = 1) {
        let n = N || SNCO.length;
        if (!SNCO.includes(id))
            throw Error('Given node is not supernode');
        let nNodes = []
        for (let i = 0, j = SNCO.indexOf(id) + 1; i < n; j++) {
            if (j == SNCO.indexOf(id))
                break;
            else if (j < SNCO.length)
                nNodes[i++] = SNCO[j]
            else j = -1
        }
        return (N == 1 ? nNodes[0] : nNodes)
    }

    kBucket.closestNode = function(id, N = 1) {
        let decodedId = decodeID(id);
        let n = N || SNCO.length;
        let cNodes = SNKB.closest(decodedId, n)
            .map(k => k.floID)
        return (N == 1 ? cNodes[0] : cNodes)
    }
})(typeof global !== "undefined" ? global : window)