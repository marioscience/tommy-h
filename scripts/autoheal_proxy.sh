#!/bin/bash

# Revisa oxide_web
if [ "$(docker container inspect -f '{{.State.Running}}' ragenodes-ultimate-oxide_web-1 2>/dev/null)" != "true" ]; then
    echo "$(date): oxide_web is down, restarting..." >> /opt/ragenodes-ultimate/scripts/autoheal_proxy.log
    docker start ragenodes-ultimate-oxide_web-1
fi

# Revisa tunnel
if [ "$(docker container inspect -f '{{.State.Running}}' ragenodes-ultimate-tunnel-1 2>/dev/null)" != "true" ]; then
    echo "$(date): tunnel is down, restarting..." >> /opt/ragenodes-ultimate/scripts/autoheal_proxy.log
    docker start ragenodes-ultimate-tunnel-1
fi
