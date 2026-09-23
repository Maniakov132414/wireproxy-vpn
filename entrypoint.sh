#!/bin/sh
set -e

echo "=========================================================="
echo " Starting Smart Dynamic Shift Rotator on Cloud (Railway)..."
echo "=========================================================="

exec node /app/rotator.js
