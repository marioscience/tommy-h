FROM lscr.io/linuxserver/webtop:ubuntu-xfce@sha256:5079531006cfe3777969da37b3f61f8c82e4112a7a67c23b4e1f12e5976804eb

# 1. Instalar Blender Oficial (AVX2/SSE4 optimizado), utilidades básicas y wmctrl
RUN apt-get update && \
    DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
    wget xz-utils libx11-6 libxi6 libxxf86vm1 libxfixes3 libxrender1 libgl1 \
    python3-numpy python3-pip git wmctrl && \
    rm -rf /var/lib/apt/lists/* && \
    wget -q https://download.blender.org/release/Blender3.6/blender-3.6.15-linux-x64.tar.xz -O /tmp/blender.tar.xz && \
    tar -xf /tmp/blender.tar.xz -C /opt && \
    rm /tmp/blender.tar.xz && \
    mv /opt/blender-3.6.15-linux-x64 /opt/blender && \
    ln -s /opt/blender/blender /usr/bin/blender && \
    sed -i 's/# gzip_/gzip_/g' /etc/nginx/nginx.conf

ENV BLENDER_USER_SCRIPTS=/usr/share/blender/scripts
ENV DEPTH=16


# 2. Clonar Sollumz de forma optimizada y limpiar metadatos Git
RUN mkdir -p /usr/share/blender/scripts/addons && \
    git clone --depth 1 --shallow-submodules --recurse-submodules https://github.com/Skylumz/Sollumz.git /usr/share/blender/scripts/addons/sollumz && \
    find /usr/share/blender/scripts/addons/sollumz -name ".git" -exec rm -rf {} + && \
    chown -R abc:abc /usr/share/blender/scripts/addons/sollumz && \
    chmod -R u=rwX,g=rX,o=rX /usr/share/blender/scripts/addons/sollumz

# 2b. Auto-habilitar addon Sollumz en el arranque de Blender
RUN mkdir -p /usr/share/blender/scripts/startup && \
    echo "import bpy" > /usr/share/blender/scripts/startup/enable_sollumz.py && \
    echo "try:" >> /usr/share/blender/scripts/startup/enable_sollumz.py && \
    echo "    import addon_utils" >> /usr/share/blender/scripts/startup/enable_sollumz.py && \
    echo "    addon_utils.enable('sollumz', default_enabled=True)" >> /usr/share/blender/scripts/startup/enable_sollumz.py && \
    echo "    if hasattr(bpy.context.preferences.system, 'viewport_aa'):" >> /usr/share/blender/scripts/startup/enable_sollumz.py && \
    echo "        bpy.context.preferences.system.viewport_aa = 'OFF'" >> /usr/share/blender/scripts/startup/enable_sollumz.py && \
    echo "    bpy.context.preferences.edit.undo_steps = 32" >> /usr/share/blender/scripts/startup/enable_sollumz.py && \
    echo "    bpy.ops.wm.save_userpref()" >> /usr/share/blender/scripts/startup/enable_sollumz.py && \
    echo "except Exception as e:" >> /usr/share/blender/scripts/startup/enable_sollumz.py && \
    echo "    print('Error auto-enabling Sollumz:', e)" >> /usr/share/blender/scripts/startup/enable_sollumz.py


# 3. Script de autoinicio (Modo Kiosko Protegido)
RUN mkdir -p /custom-cont-init.d && \
    echo '#!/bin/bash' > /custom-cont-init.d/99-blender-kiosk.sh && \
    echo 'mkdir -p /config/.config/autostart' >> /custom-cont-init.d/99-blender-kiosk.sh && \
    echo 'cat > /config/.config/autostart/kiosk.desktop <<EOF' >> /custom-cont-init.d/99-blender-kiosk.sh && \
    echo '[Desktop Entry]' >> /custom-cont-init.d/99-blender-kiosk.sh && \
    echo 'Type=Application' >> /custom-cont-init.d/99-blender-kiosk.sh && \
    echo 'Name=Blender Kiosk' >> /custom-cont-init.d/99-blender-kiosk.sh && \
    echo 'Exec=/usr/local/bin/blender-kiosk.sh' >> /custom-cont-init.d/99-blender-kiosk.sh && \
    echo 'X-GNOME-Autostart-enabled=true' >> /custom-cont-init.d/99-blender-kiosk.sh && \
    echo 'EOF' >> /custom-cont-init.d/99-blender-kiosk.sh && \
    echo 'chown -R abc:abc /config/.config' >> /custom-cont-init.d/99-blender-kiosk.sh && \
    chmod +x /custom-cont-init.d/99-blender-kiosk.sh

# 4. Crear el script de bucle de Kiosko
# - Optimizado para rendimiento desactivando el compositor de XFCE.
# - Blindaje total: elimina bordes, títulos y botones de ventana.
RUN echo '#!/bin/bash' > /usr/local/bin/blender-kiosk.sh && \
    echo 'pkill xfce4-panel' >> /usr/local/bin/blender-kiosk.sh && \
    echo 'pkill xfdesktop' >> /usr/local/bin/blender-kiosk.sh && \
    # Configurar XFWM4 para modo ultra-limpio
    echo 'xfconf-query -c xfwm4 -p /general/use_compositing -n -t bool -s false' >> /usr/local/bin/blender-kiosk.sh && \
    echo 'xfconf-query -c xfwm4 -p /general/titleless_maximize -n -t bool -s true' >> /usr/local/bin/blender-kiosk.sh && \
    echo 'xfconf-query -c xfwm4 -p /general/button_layout -n -t string -s "|"' >> /usr/local/bin/blender-kiosk.sh && \
    echo 'xfconf-query -c xfwm4 -p /general/theme -n -t string -s "Default"' >> /usr/local/bin/blender-kiosk.sh && \
    echo 'xfwm4 --replace &' >> /usr/local/bin/blender-kiosk.sh && \
    echo 'export GALLIUM_DRIVER=llvmpipe' >> /usr/local/bin/blender-kiosk.sh && \
    echo 'export LP_NUM_THREADS=$(nproc)' >> /usr/local/bin/blender-kiosk.sh && \
    echo 'while true; do' >> /usr/local/bin/blender-kiosk.sh && \
    echo '  blender &' >> /usr/local/bin/blender-kiosk.sh && \
    echo '  BLENDER_PID=$!' >> /usr/local/bin/blender-kiosk.sh && \
    echo '  # Intentar maximizar y quitar decoraciones' >> /usr/local/bin/blender-kiosk.sh && \
    echo '  (for i in {1..20}; do if wmctrl -l | grep -i "Blender" > /dev/null; then wmctrl -r "Blender" -b add,maximized_vert,maximized_horz && wmctrl -r "Blender" -b add,undecorated && break; fi; sleep 1; done) &' >> /usr/local/bin/blender-kiosk.sh && \
    echo '  wait $BLENDER_PID' >> /usr/local/bin/blender-kiosk.sh && \
    echo 'done' >> /usr/local/bin/blender-kiosk.sh && \
    chmod +x /usr/local/bin/blender-kiosk.sh
