const INVALID = function (message) {
    if (!(this instanceof INVALID))
        return new INVALID(message);
    this.message = message;
}

module.exports = {
    INVALID,
    INVALID_E_CODE: 400,
    INTERNAL_E_CODE: 500,

    INTERVAL_REFRESH_TIME: 1 * 60 * 60 * 1000, //1 hr

    backup: {
        RETRY_TIMEOUT: 5 * 60 * 1000, //5 mins
        MIGRATE_WAIT_DELAY: 5 * 60 * 1000, //5 mins
        SYNC_WAIT_TIME: 10*1000//5 * 60 * 1000 //5 mins
    }
}