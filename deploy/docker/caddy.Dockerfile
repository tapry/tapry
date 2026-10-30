# Caddy with the layer4 plugin, so port 443 can carry both the website and TURN over TLS
# (routed by server name). Build: docker build -f deploy/docker/caddy.Dockerfile -t opentake/caddy .
FROM caddy:2.11.7-builder AS builder
ARG CADDY_L4_VERSION=v0.1.2
RUN xcaddy build --with github.com/mholt/caddy-l4@${CADDY_L4_VERSION}

FROM caddy:2.11.7-alpine
COPY --from=builder /usr/bin/caddy /usr/bin/caddy
