#!/bin/bash
# EC2 user data (Amazon Linux 2023): installs Docker, checks out the game, pulls secrets
# from SSM Parameter Store and starts the stack. provision.sh fills the four settings below.
set -euo pipefail
exec > >(tee -a /var/log/cop-bootstrap.log) 2>&1

REPO_URL="__REPO_URL__"
GIT_REF="__GIT_REF__"
DOMAIN="__DOMAIN__"
PARAM_PREFIX="__PARAM_PREFIX__"
APP_DIR=/opt/cop

# A little swap so the image build never runs a small instance out of memory.
if [ ! -f /swapfile ]; then
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  echo '/swapfile swap swap defaults 0 0' >> /etc/fstab
fi

dnf install -y docker git
systemctl enable --now docker
COMPOSE_VERSION=v2.29.7
mkdir -p /usr/local/lib/docker/cli-plugins
curl -fsSL "https://github.com/docker/compose/releases/download/${COMPOSE_VERSION}/docker-compose-linux-$(uname -m)" \
  -o /usr/local/lib/docker/cli-plugins/docker-compose
chmod +x /usr/local/lib/docker/cli-plugins/docker-compose

if [ ! -d "$APP_DIR/.git" ]; then git clone "$REPO_URL" "$APP_DIR"; fi
cd "$APP_DIR"
git fetch --all --prune
git checkout "$GIT_REF"
# Branches move; tags and commits are fixed, so only a branch needs pulling.
if git symbolic-ref -q HEAD >/dev/null; then git pull --ff-only; fi

cat > /etc/cop.env <<CONF
GIT_REF=$GIT_REF
DOMAIN=$DOMAIN
PARAM_PREFIX=$PARAM_PREFIX
CONF

exec "$APP_DIR/deploy/aws/update.sh"
