FROM debian:bookworm-slim@sha256:abd67ffcfa541b485a3dff59865ab629aa048a6c613e639d36e7456b0b229241

RUN apt-get update && apt-get install -y --no-install-recommends \
    bash ca-certificates curl jq xz-utils tzdata git procps \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /opt/fivem

ARG FIVEM_DOWNLOAD_URL
ARG FIVEM_ARTIFACT_ID=unknown
LABEL org.ragenodes.image.kind="fivem-base" \
      org.ragenodes.fivem.artifact="${FIVEM_ARTIFACT_ID}"

RUN test -n "${FIVEM_DOWNLOAD_URL}" \
    && case "${FIVEM_DOWNLOAD_URL}" in https://runtime.fivem.net/artifacts/fivem/build_proot_linux/master/*) ;; *) exit 64 ;; esac \
    && curl --fail --show-error --silent --location --retry 4 --retry-delay 2 \
        -o /tmp/fx.tar.xz "${FIVEM_DOWNLOAD_URL}" \
    && tar -xf /tmp/fx.tar.xz -C /opt/fivem \
    && rm -f /tmp/fx.tar.xz

COPY start.sh /usr/local/bin/start-fivem
RUN chmod +x /usr/local/bin/start-fivem

ENTRYPOINT ["/usr/local/bin/start-fivem"]
