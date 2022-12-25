let message = `
SuperNode Storage
=================

Setup
-----
npm install                     - Install the app and node modules.
npm run help                    - List all commands.
npm run setup                   - Finish the setup (configure and reset password).
npm run configure               - Configure the app.
npm run reset-password          - Reset the password (for private-key).

(Optional) Open args/gen-param.html and Download param.json to args/ directory

Start Node
----------
npm start                       - Start the application (main).

NOTE: argument 'PASSWORD' required for 'npm start'
npm start -- -PASSWORD=<password>

(Optional) 'console.debug' is now turned off by default. pass argument '--debug' to turn it on
npm start -- -PASSWORD=<password> --debug

Debugging
---------
npm run checksum-db             - List the stored node tables and checksum
`;

console.log(message);