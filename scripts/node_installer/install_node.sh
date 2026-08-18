#!/bin/bash
# Ragenodes Core Installer Script
# This script configures a Linux machine to act as a remote node for Ragenodes Ultimate.
# It installs Docker, generates mTLS certificates, and secures the Docker daemon.

set -e

# Colores para mejor legibilidad
GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

if [ "$EUID" -ne 0 ]; then
  echo -e "${RED}Por favor, ejecuta este script como root (sudo ./install_node.sh)${NC}"
  exit 1
fi

echo -e "${BLUE}=================================================${NC}"
echo -e "${BLUE}     RAGENODES ULTIMATE - CORE INSTALLER         ${NC}"
echo -e "${BLUE}=================================================${NC}"

# Pedir datos para la auto-vinculación opcional
echo -e "${YELLOW}Opcional: Si deseas que este nodo se vincule automáticamente al panel maestro, introduce los siguientes datos.${NC}"
echo -e "${YELLOW}Si los dejas en blanco, el script solo instalará los certificados y te los mostrará para copiar a mano.${NC}"
if [ -z "$MASTER_URL" ]; then
    read -p "URL del Servidor Maestro (ej: https://panel.ragenodes.com): " MASTER_URL
fi
if [ -z "$MASTER_API_KEY" ]; then
    read -p "API_KEY Global del Servidor Maestro: " MASTER_API_KEY
fi

# 1. Instalar dependencias necesarias
echo -e "${GREEN}[1/5] Instalando dependencias básicas...${NC}"
apt-get update -y > /dev/null 2>&1
apt-get install -y openssl jq ufw curl > /dev/null 2>&1

# 2. Instalar Docker si no está instalado
if ! command -v docker &> /dev/null; then
    echo -e "${GREEN}[2/5] Instalando Docker Engine...${NC}"
    curl -fsSL https://get.docker.com -o get-docker.sh
    sh get-docker.sh > /dev/null 2>&1
    rm get-docker.sh
else
    echo -e "${YELLOW}[2/5] Docker ya está instalado. Omitiendo paso.${NC}"
fi

# 3. Generar Certificados mTLS
echo -e "${GREEN}[3/5] Generando certificados mTLS de seguridad...${NC}"
CERTS_DIR="/etc/docker/certs.d"
mkdir -p "$CERTS_DIR"
cd "$CERTS_DIR"

# Limpiar certificados antiguos
rm -f ca.pem ca-key.pem server-cert.pem server-key.pem client-cert.pem client-key.pem

# IP Pública
PUBLIC_IP=$(curl -s ifconfig.me)

# Generar CA (Autoridad Certificadora)
openssl genrsa -out ca-key.pem 4096 2>/dev/null
openssl req -new -x509 -days 3650 -key ca-key.pem -sha256 -out ca.pem -subj "/C=US/ST=Ragenodes/L=Core/O=Ragenodes/CN=$PUBLIC_IP" 2>/dev/null

# Generar Server Cert
openssl genrsa -out server-key.pem 4096 2>/dev/null
openssl req -subj "/CN=$PUBLIC_IP" -sha256 -new -key server-key.pem -out server.csr 2>/dev/null
echo "subjectAltName = IP:$PUBLIC_IP,IP:127.0.0.1" > extfile.cnf
echo "extendedKeyUsage = serverAuth" >> extfile.cnf
openssl x509 -req -days 3650 -sha256 -in server.csr -CA ca.pem -CAkey ca-key.pem -CAcreateserial -out server-cert.pem -extfile extfile.cnf 2>/dev/null

# Generar Client Cert (Para el Panel Maestro)
openssl genrsa -out client-key.pem 4096 2>/dev/null
openssl req -subj '/CN=client' -new -key client-key.pem -out client.csr 2>/dev/null
echo "extendedKeyUsage = clientAuth" > extfile-client.cnf
openssl x509 -req -days 3650 -sha256 -in client.csr -CA ca.pem -CAkey ca-key.pem -CAcreateserial -out client-cert.pem -extfile extfile-client.cnf 2>/dev/null

# Ajustar permisos
chmod 0400 ca-key.pem server-key.pem client-key.pem
chmod 0444 ca.pem server-cert.pem client-cert.pem
rm client.csr server.csr extfile.cnf extfile-client.cnf

# 4. Configurar Docker Daemon
echo -e "${GREEN}[4/5] Configurando el Demonio de Docker...${NC}"
mkdir -p /etc/docker
cat > /etc/docker/daemon.json <<EOF
{
  "tlsverify": true,
  "tlscacert": "$CERTS_DIR/ca.pem",
  "tlscert": "$CERTS_DIR/server-cert.pem",
  "tlskey": "$CERTS_DIR/server-key.pem",
  "hosts": ["tcp://0.0.0.0:2376", "unix:///var/run/docker.sock"]
}
EOF

# Modificar el archivo de servicio de systemd para evitar conflictos con 'hosts'
mkdir -p /etc/systemd/system/docker.service.d/
cat > /etc/systemd/system/docker.service.d/override.conf <<EOF
[Service]
ExecStart=
ExecStart=/usr/bin/dockerd
EOF

systemctl daemon-reload
systemctl restart docker

# 5. Crear estructura base de Ragenodes
echo -e "${GREEN}[5/5] Creando directorios base de Ragenodes...${NC}"
mkdir -p /srv/ragenodes-data/templates
chown -R 1000:1000 /srv/ragenodes-data
chmod -R u=rwX,g=rX,o= /srv/ragenodes-data

# Abrir el puerto en UFW si está activo
if command -v ufw &> /dev/null && ufw status | grep -q "Status: active"; then
    echo -e "${YELLOW}Configurando Firewall (UFW) para abrir el puerto 2376...${NC}"
    ufw allow 2376/tcp comment 'Ragenodes Docker mTLS'
fi

# 6. Desplegar OxideProxy Edge
echo -e "${GREEN}[6/6] Desplegando Escudo OxideProxy (Edge Computing)...${NC}"
PROXY_DIR="/srv/ragenodes-data/proxy/config"
mkdir -p "$PROXY_DIR"

PROXY_BACKEND="127.0.0.1:80"
if [ -n "$MASTER_URL" ]; then
    CLEAN_URL=$(echo "$MASTER_URL" | sed -e 's|^[^/]*//||' -e 's|/.*$||')
    PROXY_BACKEND="$CLEAN_URL:80"
fi

cat > "$PROXY_DIR/oxide_proxy.yml" <<EOF
ingress:
  tcp_listen_addr: "0.0.0.0:80"
  udp_listen_addr: "127.0.0.1:8080"
  max_concurrent_connections: 50000
  initial_buffer_size: 4096
routing:
  default_web_backend: "$PROXY_BACKEND"
  game_servers: []
tls:
  cert_path: ""
  key_path: ""
runtime:
  worker_threads: 2
  enable_core_pinning: false
advanced_tuning:
  ebpf_xdp:
    enabled: true
    interface: "eth0"
    ddos_mitigation_mode: "STRICT_GAMING"
    max_packet_rate_per_ip: 25000
  tcp_settings:
    tcp_nodelay: true
    keepalive_interval_secs: 30
    congestion_control: "bbr"
  security:
    rate_limit_conns_per_ip: 500
    blacklist_enabled: false
    handshake_timeout_ms: 1500
EOF

docker pull ragenodes/oxideproxy:1.0.0 > /dev/null 2>&1
# OxideProxy recibe únicamente NET_ADMIN para su filtrado de red; no usa SYS_ADMIN.
docker run -d --name oxideproxy --network host --restart always -v "$PROXY_DIR:/app/config:ro" --cap-drop=ALL --cap-add=NET_ADMIN ragenodes/oxideproxy:1.0.0 > /dev/null 2>&1
echo -e "${YELLOW}OxideProxy activado en modo Perimetral (Edge).${NC}"

echo -e "\n${BLUE}=================================================${NC}"
echo -e "${GREEN}¡INSTALACIÓN COMPLETADA CON ÉXITO!${NC}"
echo -e "${BLUE}=================================================${NC}\n"

echo -e "Este nodo está listo para recibir órdenes del Maestro de Ragenodes.\n"

if [ -n "$MASTER_URL" ] && [ -n "$MASTER_API_KEY" ]; then
    echo -e "${YELLOW}Enviando certificados a ${MASTER_URL}...${NC}"
    
    JSON_PAYLOAD=$(jq -n \
      --arg ip "$PUBLIC_IP" \
      --arg ca "$(cat $CERTS_DIR/ca.pem)" \
      --arg cert "$(cat $CERTS_DIR/client-cert.pem)" \
      --arg key "$(cat $CERTS_DIR/client-key.pem)" \
      '{ip_address: $ip, ca_pem: $ca, cert_pem: $cert, key_pem: $key}')
    
    # Normalizar URL quitando el trailing slash si existe
    MASTER_URL=$(echo "$MASTER_URL" | sed 's/\/$//')
    
    RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$MASTER_URL/api/nodes/auto-register" \
      -H "Content-Type: application/json" \
      -H "x-api-key: $MASTER_API_KEY" \
      -d "$JSON_PAYLOAD")
      
    HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
    BODY=$(echo "$RESPONSE" | sed '$d')
    
    if [ "$HTTP_CODE" -eq 200 ]; then
        echo -e "${GREEN}¡Auto-Vinculación Completada!${NC}"
        echo -e "${GREEN}$BODY${NC}"
        echo -e "\n${BLUE}El nodo ha sido registrado y los certificados han sido guardados en el servidor maestro automáticamente.${NC}"
        exit 0
    else
        echo -e "${RED}Error al intentar auto-vincular. Código HTTP: $HTTP_CODE${NC}"
        echo -e "${RED}$BODY${NC}"
        echo -e "${YELLOW}Cayendo al modo de copia manual...${NC}"
    fi
fi

echo -e "En tu panel de Ragenodes Ultimate, crea un nuevo nodo con la siguiente IP y Puerto:"
echo -e "IP: ${YELLOW}${PUBLIC_IP}${NC}"
echo -e "Puerto: ${YELLOW}2376${NC}\n"

echo -e "A continuación, se imprimen los certificados que debes copiar en tu servidor maestro."
echo -e "Crea los siguientes archivos en tu servidor MAESTRO en el directorio: /opt/ragenodes-ultimate/certs/nodes/[ID_DEL_NODO]/"
echo -e "${YELLOW}Asegúrate de copiar desde -----BEGIN... hasta ...END----- inclusive.${NC}\n"

echo -e "${BLUE}1. Contenido para 'ca.pem' (El CA es el mismo para todos los nodos, si ya lo tienes ignóralo):${NC}"
cat $CERTS_DIR/ca.pem
echo ""

echo -e "${BLUE}2. Contenido para 'cert.pem':${NC}"
cat $CERTS_DIR/client-cert.pem
echo ""

echo -e "${BLUE}3. Contenido para 'key.pem':${NC}"
cat $CERTS_DIR/client-key.pem
echo ""

echo -e "\n${GREEN}¡Listo! Una vez copiados los certificados, reinicia tu backend en el servidor maestro.${NC}"
