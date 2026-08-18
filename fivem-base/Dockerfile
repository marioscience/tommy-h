FROM debian:bookworm-slim@sha256:abd67ffcfa541b485a3dff59865ab629aa048a6c613e639d36e7456b0b229241

RUN apt-get update && apt-get install -y --no-install-recommends \
    bash ca-certificates curl jq xz-utils tzdata git procps \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /opt/fivem

RUN curl -fsSL https://changelogs-live.fivem.net/api/changelog/versions/linux/server \
    | jq -r '.recommended_download' > /tmp/fivem_url.txt \
    && curl -fsSL -o /tmp/fx.tar.xz "$(cat /tmp/fivem_url.txt)" \
    && tar -xf /tmp/fx.tar.xz -C /opt/fivem \
    && rm -f /tmp/fx.tar.xz /tmp/fivem_url.txt

COPY start.sh /usr/local/bin/start-fivem
RUN chmod +x /usr/local/bin/start-fivem

ENTRYPOINT ["/usr/local/bin/start-fivem"]
