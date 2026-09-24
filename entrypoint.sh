#!/bin/sh
set -e

echo "=========================================================="
echo " Starting Smart Dynamic Shift Rotator on Cloud (Railway)..."
echo "=========================================================="

exec node --max-old-space-size=128 /app/rotator.js
