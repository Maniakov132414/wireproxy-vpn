#!/bin/bash
# One-click installer for Wireproxy on Linux VPS
set -e

echo "=== Installing Wireproxy ==="

ARCH=$(uname -m)
case "$ARCH" in
    x86_64)  ARCH_NAME="linux_amd64" ;;
    aarch64) ARCH_NAME="linux_arm64" ;;
    armv7l)  ARCH_NAME="linux_armv7" ;;
    *) echo "Unsupported architecture: $ARCH"; exit 1 ;;
esac

LATEST_RELEASE=$(curl -s https://api.github.com/repos/pufferffish/wireproxy/releases/latest | grep "tag_name" | cut -d '"' -f 4)
if [ -z "$LATEST_RELEASE" ]; then
    LATEST_RELEASE="v1.0.8"
fi

TAR_URL="https://github.com/pufferffish/wireproxy/releases/download/${LATEST_RELEASE}/wireproxy_${ARCH_NAME}.tar.gz"
echo "Downloading Wireproxy ${LATEST_RELEASE} from ${TAR_URL}..."

TMP_DIR=$(mktemp -d)
curl -fsSL "$TAR_URL" -o "${TMP_DIR}/wireproxy.tar.gz"
tar -xzf "${TMP_DIR}/wireproxy.tar.gz" -C "$TMP_DIR"
sudo mv "${TMP_DIR}/wireproxy" /usr/local/bin/wireproxy
sudo chmod +x /usr/local/bin/wireproxy
rm -rf "$TMP_DIR"

echo "Wireproxy installed to /usr/local/bin/wireproxy"
/usr/local/bin/wireproxy --version || true

# Setup directory and systemd service
sudo mkdir -p /etc/wireproxy
if [ ! -f /etc/wireproxy/wireproxy.conf ]; then
    echo "Creating template /etc/wireproxy/wireproxy.conf..."
    sudo cp ./wireproxy.conf /etc/wireproxy/wireproxy.conf
fi

sudo cp ./wireproxy.service /etc/systemd/system/wireproxy.service
sudo systemctl daemon-reload

echo "=========================================================="
echo " Wireproxy installation completed!"
echo " 1. Edit your WireGuard keys in /etc/wireproxy/wireproxy.conf"
echo " 2. Start service: sudo systemctl enable --now wireproxy"
echo " 3. Check status:  sudo systemctl status wireproxy"
echo " Proxy ports:"
echo " - SOCKS5: 25344"
echo " - HTTP:   25345"
echo "=========================================================="
