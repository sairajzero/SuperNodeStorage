
# SuperNode Storage

## Installation
### Pre-requisite
- [X] Nodejs `version >= 12.9`
- [X] MySQL Server

### Download
Download the repository using git:
```
git clone https://github.com/ranchimall/SuperNodeStorage.git
```

### Install
Install using npm:
```
cd SuperNodeStorage
npm install
```

### Configuration

#### General Configuration
Copy `config-sample.json` to `config.json` and Edit the values as required.
```
{
"privateKey": "<private-key>",
"port": "<port>",

"sql_user": "<MySQL-username>",
"sql_pwd": "<MySQL-password>",
"sql_db": "<database-name>",
"sql_host": "<sql-host>"
}
```
- **private-key**: Private key of the cloud
- **port**: Port of the server to run on
- **MySQL-username**: Username for MySQL
- **MySQL-password**: Password for MySQL
- **database-name**: Database in which the data should be stored (default: ***supernode***)
- **sql-host**: Host of the MySQL server (default: ***localhost***).

***Recommended*** *(optional)* Create and use a MySQL user instead of root. Remember to give access to the database to the user.

#### Parameter Generation
Open `gen-param.html` in a browser and download `param.json` to `SuperNodeStorage` directory.

*Note: param.json is used for controlled random values used by SecureRandom in Cryptography*

## Starting the Server
After successful installation and configuration using the above steps, SuperNodeStorage can be started using:
```
npm start
```

##
For more detailed Installation, check the wiki [here](https://github.com/ranchimall/SuperNodeStorage/wiki).