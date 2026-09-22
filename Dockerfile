# Multi-architecture Dockerfile for Wireproxy & Rotator
FROM alpine:3.20

RUN apk add --no-cache ca-certificates tzdata curl nodejs tar gzip

# Download official pre-compiled wireproxy binary (instant build, no Go compilation failures)
RUN ARCH="$(uname -m)" && \
    if [ "$ARCH" = "x86_64" ]; then ARCH="amd64"; elif [ "$ARCH" = "aarch64" ]; then ARCH="arm64"; else ARCH="amd64"; fi && \
    curl -sSL "https://github.com/windtf/wireproxy/releases/download/v1.1.3/wireproxy_linux_${ARCH}.tar.gz" | tar -xz -C /usr/local/bin/ && \
    chmod +x /usr/local/bin/wireproxy

WORKDIR /app

# Copy configs and rotator script
COPY . /app

# Expose Master Rotator port (10800) and individual ports
EXPOSE 10800 25344 25345 25346 25347 25348 25349 25350 25351

RUN chmod +x /app/entrypoint.sh

ENTRYPOINT ["/app/entrypoint.sh"]

