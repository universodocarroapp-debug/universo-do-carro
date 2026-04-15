#!/bin/bash
# deploy.sh — executa na VPS para clonar/atualizar e subir o container
set -e

APP_DIR="/opt/universo-do-carro"
REPO="https://github.com/universodocarroapp-debug/universo-do-carro.git"

echo ""
echo "========================================"
echo "  Universo do Carro — Deploy"
echo "========================================"

# 1. Clonar ou atualizar o repositório
if [ -d "$APP_DIR/.git" ]; then
    echo "→ Repositório encontrado. Atualizando..."
    cd "$APP_DIR"
    git pull origin main
else
    echo "→ Clonando repositório..."
    git clone "$REPO" "$APP_DIR"
    cd "$APP_DIR"
fi

cd "$APP_DIR"

# 2. Verificar .env
if [ ! -f ".env" ]; then
    echo ""
    echo "❌  Arquivo .env não encontrado!"
    echo "    Crie o arquivo antes de continuar:"
    echo ""
    echo "    nano $APP_DIR/.env"
    echo ""
    echo "    Variáveis obrigatórias (veja .env.example):"
    echo "      SUPABASE_SERVICE_KEY=eyJ..."
    echo "      DOMAIN=app.seudominio.com.br"
    echo "      ALLOWED_ORIGINS=https://app.seudominio.com.br"
    echo "      TRAEFIK_NETWORK=traefik-net"
    echo ""
    exit 1
fi

# 3. Detectar rede do Traefik automaticamente
TRAEFIK_NET=$(docker network ls --filter name=traefik --format "{{.Name}}" | head -1)
if [ -z "$TRAEFIK_NET" ]; then
    TRAEFIK_NET="traefik-net"
    echo "⚠  Rede Traefik não detectada. Criando 'traefik-net'..."
    docker network create "$TRAEFIK_NET" 2>/dev/null || true
fi
echo "→ Rede Traefik: $TRAEFIK_NET"

# 4. Build e start
echo "→ Buildando e iniciando container..."
docker compose down --remove-orphans 2>/dev/null || true
docker compose up -d --build

echo ""
echo "✅  Deploy concluído!"
echo ""
docker compose ps
echo ""
echo "  Logs em tempo real: docker compose logs -f app"
echo ""
