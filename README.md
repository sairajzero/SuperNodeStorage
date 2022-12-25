
# SuperNode Storage

## Installation

### Pre-requisite
- [X] Nodejs `version >= 12.9` (`--lts` recommended)
- [X] MySQL Server `version > 8.0`

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
Finish the configuration when prompted

### Configuration

#### General Configuration
If not finished during installation, or to re-configure use:
```
npm run configure
```
- **port**: Port of the server to run on
- **MySQL host**: Host of the MySQL server (default: ***localhost***)
- **Database name**: Database in which the data should be stored (`<database-name>`) (default: ***supernode***)
- **MySQL username**: Username for MySQL (`<sql-username>`)
- **MySQL password**: Password for MySQL (`<sql-password>`)

***Recommended*** *(optional)* Create and use a MySQL user instead of root. Remember to give access to the database to the user.

#### Set/Reset Node key password
If not set during installation, or to reset password, use:
```
npm run reset-password
```
- **private key**: Private key of the node
- **password**: Password to set for the node (`<password>`)

**Note**: Private key of the node is encrypted using the `<password>`. Thus use a ***strong*** password.

### More
For help or list of all commands, use
```
npm run help
```

## Starting the Server
After successful installation and configuration using the above steps, SuperNodeStorage can be started using:
```
npm start -- -PASSWORD=<password>
```

##
For more information and detailed installation, check the wiki [here](https://github.com/ranchimall/SuperNodeStorage/wiki).
