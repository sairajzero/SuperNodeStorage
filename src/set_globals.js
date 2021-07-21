'use strict';
//fetch for node js (used in floBlockchainAPI.js)
global.fetch = require("node-fetch");

//Set browser parameters from parameters.json
const parameters = require('../parameters.json')
for(let p in parameters)
    global[p] = parameters[p];