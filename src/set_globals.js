'use strict';
//fetch for node js (used in floBlockchainAPI.js)
global.fetch = require("node-fetch");

//Set browser paramaters from param.json
const param = require('../param.json');
for(let p in param)
    global[p] = param[p];