#!/bin/bash
# Redeploy on the instance: fetch the configured git ref, refresh secrets from SSM, rebuild.
# Run as root (e.g. via SSM Session Manager): sudo /opt/cop/deploy/aws/update.sh [git-ref]
set -euo pipefail
source /etc/cop.env
REF="${1:-$GIT_REF}"
cd /opt/cop
git fetch --all --prune
git checkout "$REF"
# Branches move; tags and commits are fixed, so only a branch needs pulling.
if git symbolic-ref -q HEAD >/dev/null; then git pull --ff-only; fi

# Secrets live only in SSM and in this root-only file on the instance, never in the repo.
REGION=$(TOKEN=$(curl -fsS -X PUT http://169.254.169.254/latest/api/token -H 'X-aws-ec2-metadata-token-ttl-seconds: 60') \
  && curl -fsS -H "X-aws-ec2-metadata-token: $TOKEN" http://169.254.169.254/latest/meta-data/placement/region)
param() { aws ssm get-parameter --region "$REGION" --with-decryption --name "$PARAM_PREFIX/$1" --query Parameter.Value --output text; }
umask 077
cat > deploy/aws/.env <<CONF
SUPABASE_URL=$(param SUPABASE_URL)
SUPABASE_SECRET_KEY=$(param SUPABASE_SECRET_KEY)
CONF

cd deploy/aws
DOMAIN="$DOMAIN" docker compose up -d --build --remove-orphans
docker image prune -f
echo "Deployed $(git -C /opt/cop rev-parse --short HEAD) to https://$DOMAIN"
