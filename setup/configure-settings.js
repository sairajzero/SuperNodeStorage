const fs = require('fs');
const path = require('path');
const getInput = require('./getInput');

var config, flag_new;
try {
    config = require(`../args/config.json`);
    flag_new = false;
} catch (error) {
    config = {
        "port": "8080",

        "sql_user": "mySQL_user",
        "sql_pwd": "mySQL_password",
        "sql_db": "supernode",
        "sql_host": "localhost"
    };
    flag_new = true;
}

function flaggedYesOrNo(text) {
    return new Promise((resolve) => {
        if (flag_new)
            resolve(true);
        else
            getInput.YesOrNo(text)
                .then(result => resolve(result))
                .catch(error => reject(error))
    })
}

function configurePort() {
    return new Promise(resolve => {
        getInput.Text('Enter port', config["port"]).then(port => {
            config["port"] = port;
            resolve(true);
        })
    })
}

function configureSQL() {
    return new Promise(resolve => {
        flaggedYesOrNo('Do you want to re-configure mySQL connection').then(value => {
            if (value) {
                console.log('Enter mySQL connection values: ')
                getInput.Text('MySQL host', config['sql_host']).then(host => {
                    config['sql_host'] = host;
                    getInput.Text('Database name', config['sql_db']).then(dbname => {
                        config['sql_db'] = dbname;
                        getInput.Text('MySQL username', config['sql_user']).then(sql_user => {
                            config['sql_user'] = sql_user;
                            getInput.Text('MySQL password', config['sql_pwd']).then(sql_pwd => {
                                config['sql_pwd'] = sql_pwd;
                                resolve(true);
                            })
                        })
                    })
                })
            } else
                resolve(false);
        })
    })
}

function configure() {
    return new Promise((resolve, reject) => {
        configurePort().then(port_result => {
            configureSQL().then(sql_result => {
                fs.writeFile(path.resolve(__dirname, '..', 'args', `config.json`), JSON.stringify(config), 'utf8', (err) => {
                    if (err) {
                        console.error(err);
                        return reject(false);
                    }
                    console.log('Configuration successful!');
                    resolve(true);
                })
            })
        });
    })
}

if (!module.parent)
    configure().then(_ => null).catch(error => console.error(error)).finally(_ => process.exit(0));
else
    module.exports = configure;