#!/bin/bash
# 🚀 RageNodes Node Setup Script v1.0
# Uso: curl -sSL https://tu-dominio.com/setup_node.sh | bash -s -- --key TU_API_KEY

set -e

# Colores para la terminal
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${BLUE}-------------------------------------------------------${NC}"
echo -e "${BLUE}🌐 Configuración de Nodo Distribuido - RageNodes${NC}"
echo -e "${BLUE}-------------------------------------------------------${NC}"

# 1. Actualización del Sistema
echo -e "${YELLOW}📦 Actualizando repositorios...${NC}"
apt-get update && apt-get upgrade -y

# 2. Instalación de Docker
if ! [ -x "$(command -v docker)" ]; then
    echo -e "${YELLOW}🐳 Instalando Docker Engine...${NC}"
    curl -fsSL https://get.docker.com -o get-docker.sh
    sh get-docker.sh
    rm get-docker.sh
else
    echo -e "${GREEN}✅ Docker ya está instalado.${NC}"
fi

# 3. Preparación de directorios
echo -e "${YELLOW}📂 Creando estructuras de datos...${NC}"
mkdir -p /srv/ragenodes-data
mkdir -p /srv/ragenodes-backups

# 4. Configuración de acceso remoto (Docker over TCP + TLS opcional)
echo -e "${YELLOW}📡 Configurando acceso remoto...${NC}"
mkdir -p /etc/systemd/system/docker.service.d

# Detectar si se pasaron certificados
if [ -f "ca.pem" ] && [ -f "cert.pem" ] && [ -f "key.pem" ]; then
    echo -e "${GREEN}🔐 Certificados detectados. Activando modo TLS (Cifrado)...${NC}"
    mkdir -p /etc/docker/certs
    cp ca.pem cert.pem key.pem /etc/docker/certs/
    chmod 600 /etc/docker/certs/key.pem
    
    cat <<EOF > /etc/systemd/system/docker.service.d/override.conf
[Service]
ExecStart=
ExecStart=/usr/bin/dockerd -H fd:// -H tcp://0.0.0.0:2376 --tlsverify --tlscacert=/etc/docker/certs/ca.pem --tlscert=/etc/docker/certs/cert.pem --tlskey=/etc/docker/certs/key.pem
EOF
else
    echo -e "${YELLOW}⚠️ No se detectaron certificados. Configurando conexión NO cifrada (Solo desarrollo).${NC}"
    cat <<EOF > /etc/systemd/system/docker.service.d/override.conf
[Service]
ExecStart=
ExecStart=/usr/bin/dockerd -H fd:// -H tcp://0.0.0.0:2376
EOF
fi

# 5. Optimizaciones del Sistema para Juegos
echo -e "${YELLOW}⚡ Aplicando optimizaciones de latencia y recursos...${NC}"
sysctl -w vm.swappiness=10
echo "vm.swappiness=10" >> /etc/sysctl.conf
echo "* soft nofile 1000000" >> /etc/security/limits.conf
echo "* hard nofile 1000000" >> /etc/security/limits.conf

# 6. Reinicio de servicios
echo -e "${YELLOW}🔄 Reiniciando Docker...${NC}"
systemctl daemon-reload
systemctl restart docker

# 7. Finalización
IP=$(curl -s https://ifconfig.me)
echo -e "${BLUE}-------------------------------------------------------${NC}"
echo -e "${GREEN}🎉 ¡Nodo configurado con éxito!${NC}"
echo -e "${BLUE}-------------------------------------------------------${NC}"
echo -e "Ahora puedes agregarlo en tu Panel Admin de RageNodes:"
echo -e "📍 IP: ${GREEN}${IP}${NC}"
echo -e "🔌 Puerto: ${GREEN}2376${NC}"
echo -e "🛡️  Estado: ${GREEN}Listo para recibir contenedores${NC}"
echo -e "${BLUE}-------------------------------------------------------${NC}"
