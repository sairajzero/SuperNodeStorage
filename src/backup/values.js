'use strict';
const keys = require('../keys');

const SUPERNODE_INDICATOR = '$';

//List of node backups stored
const _list = {};
Object.defineProperty(_list, 'delete', {
    value: function (id) {
        delete this[id];
    }
});
Object.defineProperty(_list, 'get', {
    value: function (keys = null) {
        if (keys === null) keys = Object.keys(this);
        if (Array.isArray(keys))
            return Object.fromEntries(keys.map(k => [k, this[k]]));
        else
            return this[keys];
    }
});
Object.defineProperty(_list, 'stored', {
    get: function () {
        return Object.keys(this);
    }
});
Object.defineProperty(_list, 'serving', {
    get: function () {
        let serveList = [];
        for (let id in this)
            if (this[id] === 0)
                serveList.push(id);
        return serveList;
    }
});

//Node container
function NodeContainer() {
    var _ws, _id, _onmessage, _onclose;
    Object.defineProperty(this, 'set', {
        value: function (id, ws) {
            if (_ws !== undefined)
                this.close();
            _id = id;
            _ws = ws;
            if (_onmessage)
                _ws.onmessage = _onmessage;
            if (_onclose)
                _ws.onclose = _onclose;
        }
    });
    Object.defineProperty(this, 'id', {
        get: function () {
            return _id;
        }
    });
    Object.defineProperty(this, 'readyState', {
        get: function () {
            if (_ws instanceof WebSocket)
                return _ws.readyState;
            else
                return null;
        }
    });
    Object.defineProperty(this, 'send', {
        value: function (packet) {
            _ws.send(packet);
        }
    });
    Object.defineProperty(this, 'onmessage', {
        set: function (fn) {
            if (fn instanceof Function)
                _onmessage = fn;
        }
    });
    Object.defineProperty(this, 'onclose', {
        set: function (fn) {
            if (fn instanceof Function)
                _onclose = fn;
        }
    });
    Object.defineProperty(this, 'is', {
        value: function (ws) {
            return ws === _ws;
        }
    });
    Object.defineProperty(this, 'close', {
        value: function () {
            if (_ws.readyState === 1) {
                _ws.onclose = () => console.warn('Closing: ' + _id);
                _ws.close();
            };
            _ws = _id = undefined;
        }
    });
};

//Container for next-node
const _nextNode = new NodeContainer();
//Container for prev-node
const _prevNode = new NodeContainer();

//Packet processing
const packet_ = {};
packet_.construct = function (message) {
    const packet = {
        from: keys.node_id,
        message: message,
        time: Date.now()
    };
    packet.sign = floCrypto.signData(this.s(packet), keys.node_priv);
    return SUPERNODE_INDICATOR + JSON.stringify(packet);
};
packet_.s = d => [JSON.stringify(d.message), d.time].join("|");
packet_.parse = function (str) {
    try {
        let packet = JSON.parse(str.substring(SUPERNODE_INDICATOR.length));
        let curTime = Date.now();
        if (packet.time > curTime - floGlobals.sn_config.delayDelta &&
            packet.from in floGlobals.supernodes &&
            floCrypto.verifySign(this.s(packet), packet.sign, floGlobals.supernodes[packet.from].pubKey)) {
            if (!Array.isArray(packet.message))
                packet.message = [packet.message];
            return packet;
        } else
            return false;
    } catch (error) {
        console.error(str, error);
        return false;
    };
};


module.exports = {
    _list,
    _nextNode,
    _prevNode,
    packet_,
    SUPERNODE_INDICATOR
}