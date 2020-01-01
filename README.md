
# SuperNodeStorage
FLO Supernode Storage is a Cloud Storage progam for FLO Dapps

## Installation
1. Download or clone the [repo](https://github.com/ranchimall/SuperNodeStorage):

		git clone https://github.com/ranchimall/SuperNodeStorage
2. Add a strong <server_password>  in `.config` file
3. Change other configurations (if needed)
4. Host and publish the domain name or IP with port

## Usage
1. Start the app using the following command in terminal. The server WSS will be started and the supernode html-js will be opened in the browser.

		./start_supernode.sh
2.  (Only for first time login) Enter the <server_password> and <private_key> when prompted

The Supernode storage will automatically start

NOTE: The <server_password> and <private_key> will be stored securedly in IndexedDB of the browser

NOTE: Users may add `start_supernode` to bootup process to automatically start the supernode during boot up
