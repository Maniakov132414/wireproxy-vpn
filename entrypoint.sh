#!/bin/sh
set -e

echo "=========================================================="
echo " Starting Multi-Country Wireproxy Cluster on Cloud..."
echo "=========================================================="

CONFIGS_DIR="/app/configs"

if [ -d "$CONFIGS_DIR" ]; then
    for conf in "$CONFIGS_DIR"/*.conf; do
        if [ -f "$conf" ]; then
            echo " [+] Launching Wireproxy for $(basename "$conf")..."
            /usr/local/bin/wireproxy -s -c "$conf" &
        fi
    done
fi

# Fallback if wireproxy.conf exists in root
if [ -f "/app/wireproxy.conf" ] && [ ! -d "$CONFIGS_DIR" ]; then
    echo " [+] Launching single Wireproxy instance..."
    /usr/local/bin/wireproxy -s -c /app/wireproxy.conf &
fi

sleep 2

echo "=========================================================="
echo " Starting Dynamic Rotating Proxy Pool on Port 10800..."
echo "=========================================================="
exec node /app/rotator.js
