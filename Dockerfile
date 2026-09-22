# Multi-architecture Dockerfile for Wireproxy
FROM golang:1.22-alpine AS builder

RUN apk add --no-cache git
ENV CGO_ENABLED=0
RUN go install github.com/pufferffish/wireproxy/cmd/wireproxy@latest

FROM alpine:3.20

RUN apk add --no-cache ca-certificates tzdata curl nodejs
WORKDIR /app

COPY --from=builder /go/bin/wireproxy /usr/local/bin/wireproxy

# Copy configs and rotator script
COPY . /app

# Expose Master Rotator port (10800) and individual ports
EXPOSE 10800 25344 25345 25346 25347 25348 25349 25350 25351

RUN chmod +x /app/entrypoint.sh

ENTRYPOINT ["/app/entrypoint.sh"]
