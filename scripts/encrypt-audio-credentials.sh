#!/bin/bash
# Script para encriptar credenciales de audio en Linux/Mac
# 
# Uso:
#   chmod +x scripts/encrypt-audio-credentials.sh
#   ./scripts/encrypt-audio-credentials.sh
#   O pasar la clave como argumento:
#   ./scripts/encrypt-audio-credentials.sh "tu-api-key-aqui"

echo "========================================"
echo " Encriptador de Credenciales de Audio"
echo "========================================"
echo ""

if [ -z "$1" ]; then
    echo "Modo interactivo..."
    echo ""
    node scripts/encrypt-key.js
else
    echo "Encriptando clave proporcionada..."
    echo ""
    node scripts/encrypt-key.js "$1"
fi

echo ""
echo "========================================"

