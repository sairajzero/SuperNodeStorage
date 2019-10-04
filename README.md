# Standard_Operations
 Standard operations required for FLO Crypto, Blockchain API, Supernode WS, IndexedDB 

This template contains standard operations that can be used for the following:
1. FLO Globals
2. FLO Crypto  Operations 
3. FLO Blockchain API Operations
4. FLO SuperNode Websocket Operations
5. compact IndexedDB Operations

## FLO Globals 
`floGlobals` object contains the global variables and constants required for the operations.  Make sure to add this object before any other scripts.
`floGlobals` contains the following properties :
1. `blockchain` : Indicates the blockchain (`"FLO"` or `"FLO_TEST"`).
2. `apiURL` : Indicates the URL for blockchain API calls. 
3. `adminID` : Indicates the master admin FLO ID for the project.
4. `sendAmt` :  Indicates the default flo amount to be sent while sending transactions into the blockchain
5. `fee` : Indicates the default fee amount to be deduced while sending transactions into the blockchain
6. `supernodes` : Holder for the supernode list. Can be updated in runtime while retriving data from blockchain using API. Stored in the Object format,

		{
			<supernodeFLOID> : {
				uri : <supernodeURI>
				...(otherProperties)
				}
			...(Other Supernodes)
		}

## FLO Crypto Operations
`floCrypto` operations can be used to perform blockchain-cryptography methods. `floCrypto` operations are synchronized and return a value. Contains the following Operations.
#### Generate New FLO ID pair
	floCrypto.generateNewID()
 `generateNewID`  generates a new flo ID and returns private-key, public-key and floID

#### 	Calculate Public Key Hex
`getPubKeyHex` returns public-key from given private-key
	 floCrypto.getPubKeyHex(privateKey)
1. privateKey - private key in WIF format (Hex) 

#### 	Calculate FLO ID
	 floCrypto.getFloIDfromPubkeyHex(publicKey)
`getFloIDfromPubkeyHex` returns flo-ID from public-key
1. publicKey - public key hex value 

#### 	Verify Private Key
	 floCrypto.verifyPrivKey(privateKey, pubKey_floID, *isfloID)
`verifyPrivKey` verify the private-key for the given public-key or flo-ID
1. privateKey - private key in WIF format (Hex) 
2. pubKey_floID - public Key or flo ID
3. isfloID - boolean value (true - compare as flo ID, false - compare as public key) (optional, default is true)

#### 	Validate FLO ID
	 floCrypto.validateAddr(floID)
`validateAddr` check if the given Address is valid or not
1. floID - flo ID to validate 

#### 	Data Encryption
	 floCrypto.encryptData(data, publicKey)
`encryptData` encrypts the given data using public-key
1. data - data to encrypt
2. publicKey - public key of the recipient

#### 	Data Decryption
	 floCrypto.decryptData(data, privateKey)
`decryptData` decrypts the given data using private-key
1. data - encrypted data to decrypt (Object that was returned from encryptData)
2. privateKey - private key of the recipient

#### 	Sign Data
	 floCrypto.signData(data, privateKey)
`signData` signs the data using the private key
1. data - data to sign
2. privateKey - private key of the signer

####  Verify Signature
	 floCrypto.decryptData(data, signature, publicKey)
`decryptData` verifies signatue of the data using public-key
1. data - data of the given signature
2. signature - signature of the data
3. publicKey - public key of the signer
