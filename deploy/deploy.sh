#!/usr/bin/env bash
# Gera o build e publica em /var/www/cnabstudio.
set -euo pipefail
cd "$(dirname "$0")/.."
npm ci
npm run build
sudo mkdir -p /var/www/cnabstudio
sudo rsync -a --delete dist/ /var/www/cnabstudio/
sudo chown -R www-data:www-data /var/www/cnabstudio
echo "Publicado em /var/www/cnabstudio"
