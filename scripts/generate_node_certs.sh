#!/bin/bash
# 🔐 RageNodes PKI Generator v1.0
# Genera una CA y certificados para nodos distribuidos.

CA_DIR="./certs/ca"
NODES_DIR="./certs/nodes"
NODE_ID=$1
NODE_IP=$2

if [ -z "$NODE_ID" ] || [ -z "$NODE_IP" ]; then
    echo "Uso: $0 <NODE_ID> <NODE_IP>"
    exit 1
fi

mkdir -p $CA_DIR
mkdir -p $NODES_DIR/$NODE_ID

# 1. Crear CA si no existe
if [ ! -f "$CA_DIR/ca.key" ]; then
    echo "🔑 Generando CA de RageNodes..."
    openssl genrsa -out $CA_DIR/ca.key 4096
    openssl req -new -x509 -days 3650 -key $CA_DIR/ca.key -out $CA_DIR/ca.pem -subj "/CN=RageNodes-CA"
fi

# 2. Generar Certificado para el Nodo
echo "📜 Generando certificado para Nodo #$NODE_ID ($NODE_IP)..."
openssl genrsa -out $NODES_DIR/$NODE_ID/key.pem 2048
openssl req -new -key $NODES_DIR/$NODE_ID/key.pem -out $NODES_DIR/$NODE_ID/node.csr -subj "/CN=$NODE_IP"

# Extensión para permitir la IP
echo "subjectAltName = IP:$NODE_IP, IP:127.0.0.1" > $NODES_DIR/$NODE_ID/extfile.cnf
echo "extendedKeyUsage = clientAuth,serverAuth" >> $NODES_DIR/$NODE_ID/extfile.cnf

# Firmar con la CA
openssl x509 -req -days 365 -sha256 -in $NODES_DIR/$NODE_ID/node.csr -CA $CA_DIR/ca.pem -CAkey $CA_DIR/ca.key \
  -CAcreateserial -out $NODES_DIR/$NODE_ID/cert.pem -extfile $NODES_DIR/$NODE_ID/extfile.cnf

# Limpiar archivos temporales
rm $NODES_DIR/$NODE_ID/node.csr $NODES_DIR/$NODE_ID/extfile.cnf

echo "✅ Certificados generados en $NODES_DIR/$NODE_ID/"
echo "Archivos necesarios para el nodo worker:"
echo " - $CA_DIR/ca.pem"
echo " - $NODES_DIR/$NODE_ID/cert.pem"
echo " - $NODES_DIR/$NODE_ID/key.pem"
