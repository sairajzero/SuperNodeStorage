#!/bin/sh

current_date=$(date)
echo "$current_date : Starting Supernode" >> logs/app.log

#Read configurations
IFS="="
while read -r var value
do
export "$var"="${value}"
done < .config

#Start the app
echo $current_date >> logs/server.log
app/supernodeWSS.bin $PORT $SERVER_PWD >> logs/server.log &
echo $current_date >> logs/browser.log
$BROWSER app/index.html >> logs/browser.log &
wait

