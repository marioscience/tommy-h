#!/bin/bash
echo -e "\e[36m===================================================\e[0m"
echo -e "\e[32m      RAGENODES ULTIMATE - ROM AUTO-DOWNLOADER     \e[0m"
echo -e "\e[36m===================================================\e[0m"
echo -e "Este script descargará juegos masivamente para"
echo -e "CUALQUIER consola que soporte EmulatorJS."
echo -e "---------------------------------------------------"

echo -e "\e[33mConsolas disponibles detectadas en tu sistema:\e[0m"
# Listamos las carpetas disponibles en el servidor
pct exec 102 -- bash -c "ls -1 /opt/emulatorjs/data/ | grep -v 'config' | grep -v 'plugins' | grep -v 'assets' | xargs -n 5 echo"

echo ""
echo -e "\e[36mEjemplo: psx, snes, nes, n64, sega32x, gba, gbc...\e[0m"
read -p "Escribe el nombre EXACTO de la consola: " console

# Validar que no esté vacío
if [ -z "$console" ]; then
    echo -e "\e[31mError: Consola no válida.\e[0m"
    exit 1
fi

echo ""
echo -e "\e[36m¿Qué formato de archivos quieres descargar? (Ejemplo: chd, zip, nes, z64, sfc)\e[0m"
echo -e "\e[33mNota: Si la web tiene todo en zips, pon zip. Si es de PS1, pon chd.\e[0m"
read -p "Formato de archivo (sin el punto): " formato

if [ -z "$formato" ]; then
    echo -e "\e[31mError: Debes poner un formato.\e[0m"
    exit 1
fi

echo ""
echo -e "\e[33mCONSEJO: Ve a archive.org, busca un catálogo masivo y pega aquí el link.\e[0m"
read -p "Pega el enlace web de descarga: " url

if [ -z "$url" ]; then
    echo -e "\e[31mError: No has puesto ningún enlace.\e[0m"
    exit 1
fi

echo -e "\e[36m===================================================\e[0m"
echo -e "\e[33mIniciando descarga masiva directa al servidor...\e[0m"
echo -e "\e[36mRuta interna: /opt/emulatorjs/data/$console/roms/\e[0m"
echo -e "\e[36mFormato a descargar: *.$formato\e[0m"
echo -e "\e[36m===================================================\e[0m"

# Crear la ruta si no existe (por si escriben una consola nueva)
pct exec 102 -- mkdir -p "/opt/emulatorjs/data/$console/roms"

# Ejecutar la descarga masiva dentro del contenedor LXC
pct exec 102 -- bash -c "cd /opt/emulatorjs/data/$console/roms && wget -e robots=off -r -np -nH --cut-dirs=3 -A \"*.$formato\" \"$url\""

echo -e "\e[32m¡Descarga masiva finalizada!\e[0m"
echo -e "\e[33mArreglando permisos para la web...\e[0m"
pct exec 102 -- chown -R 1000:1000 "/opt/emulatorjs/data/$console/roms"

echo -e "\e[33mAvisando a EmulatorJS para que procese los juegos...\e[0m"
pct exec 102 -- docker exec emulatorjs_test bash -c "echo \"const io = require('/emulatorjs/node_modules/socket.io-client'); const socket = io('http://127.0.0.1:3000'); socket.emit('scanroms', {folder: '$console'}); setTimeout(() => process.exit(0), 1000);\" > /tmp/scan.js && node /tmp/scan.js"

echo -e "\e[32m===================================================\e[0m"
echo -e "\e[32m¡TODO LISTO! Los juegos ya están en tu sistema.\e[0m"
echo -e "\e[32mVe al Panel de Admin -> $console -> Download All Art\e[0m"
echo -e "\e[32m===================================================\e[0m"
