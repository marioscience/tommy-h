#!/bin/bash
# Script de Despliegue Automatizado - RageNodes Master
# Instala el entorno Docker mTLS en un nodo remoto vía SSH.

set -e

GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${BLUE}=================================================${NC}"
echo -e "${BLUE}   RAGENODES - AUTO DEPLOYER DE NODOS REMOTOS    ${NC}"
echo -e "${BLUE}=================================================${NC}"

read -p "IP del Servidor en Blanco: " TARGET_IP
read -p "Usuario SSH [root]: " TARGET_USER
TARGET_USER=${TARGET_USER:-root}

read -p "URL del Maestro (ej: https://panel.ragenodes.com o http://MI_IP): " MASTER_URL
read -p "API KEY Global del Maestro: " MASTER_API_KEY

if [ -z "$TARGET_IP" ] || [ -z "$MASTER_URL" ] || [ -z "$MASTER_API_KEY" ]; then
    echo -e "${RED}Error: IP, URL y API KEY son obligatorios.${NC}"
    exit 1
fi

echo -e "\n${YELLOW}Iniciando conexión SSH con $TARGET_USER@$TARGET_IP...${NC}"
echo -e "${YELLOW}Se te pedirá la contraseña SSH (si no usas llaves RSA).${NC}"

# Construimos el comando remoto inyectando las variables de entorno
COMMAND="export MASTER_URL=\"$MASTER_URL\" && \
export MASTER_API_KEY=\"$MASTER_API_KEY\" && \
curl -sL $MASTER_URL/api/installer | bash"

ssh -t -o StrictHostKeyChecking=no "$TARGET_USER@$TARGET_IP" "$COMMAND"

echo -e "\n${GREEN}✔ El proceso de despliegue ha finalizado.${NC}"
echo -e "Si todo ha salido bien, el nodo aparecerá automáticamente en tu panel de administración."
