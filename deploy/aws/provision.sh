#!/bin/bash
# One-time AWS setup for the game server: secrets in SSM Parameter Store, an instance role that
# can read only those, a security group open on 80/443, an EC2 instance that bootstraps itself
# (bootstrap.sh) and a fixed Elastic IP. Needs the AWS CLI v2, configured (`aws configure`).
#
#   DOMAIN=api.example.com SUPABASE_URL=https://xyz.supabase.co SUPABASE_SECRET_KEY=sb_secret_... \
#     deploy/aws/provision.sh
#
# Afterwards point DOMAIN's A record at the printed IP; Caddy fetches the certificate itself.
set -euo pipefail

: "${DOMAIN:?set DOMAIN, the hostname the game server will answer on (e.g. api.example.com)}"
: "${SUPABASE_URL:?set SUPABASE_URL}"
: "${SUPABASE_SECRET_KEY:?set SUPABASE_SECRET_KEY (Supabase → Project Settings → API Keys)}"
REGION="${AWS_REGION:-$(aws configure get region)}"
: "${REGION:?set AWS_REGION or a default region in aws configure}"
NAME="${NAME:-cop-server}"
INSTANCE_TYPE="${INSTANCE_TYPE:-t4g.small}"
REPO_URL="${REPO_URL:-https://github.com/ahmedfahim21/CoP.git}"
GIT_REF="${GIT_REF:-main}"
PARAM_PREFIX="${PARAM_PREFIX:-/cop}"
HERE="$(cd "$(dirname "$0")" && pwd)"
aws() { command aws --region "$REGION" "$@"; }

echo "→ Secrets into SSM Parameter Store under $PARAM_PREFIX"
aws ssm put-parameter --name "$PARAM_PREFIX/SUPABASE_URL" --type String --value "$SUPABASE_URL" --overwrite >/dev/null
aws ssm put-parameter --name "$PARAM_PREFIX/SUPABASE_SECRET_KEY" --type SecureString --value "$SUPABASE_SECRET_KEY" --overwrite >/dev/null

echo "→ Instance role: Session Manager access, read-only on $PARAM_PREFIX/*"
ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
if ! aws iam get-role --role-name "$NAME" >/dev/null 2>&1; then
  aws iam create-role --role-name "$NAME" --assume-role-policy-document '{
    "Version": "2012-10-17",
    "Statement": [{ "Effect": "Allow", "Principal": { "Service": "ec2.amazonaws.com" }, "Action": "sts:AssumeRole" }]
  }' >/dev/null
  aws iam attach-role-policy --role-name "$NAME" --policy-arn arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore
fi
aws iam put-role-policy --role-name "$NAME" --policy-name read-cop-params --policy-document "{
  \"Version\": \"2012-10-17\",
  \"Statement\": [{ \"Effect\": \"Allow\", \"Action\": [\"ssm:GetParameter\", \"ssm:GetParameters\"],
    \"Resource\": \"arn:aws:ssm:$REGION:$ACCOUNT:parameter$PARAM_PREFIX/*\" }]
}"
if ! aws iam get-instance-profile --instance-profile-name "$NAME" >/dev/null 2>&1; then
  aws iam create-instance-profile --instance-profile-name "$NAME" >/dev/null
  aws iam add-role-to-instance-profile --instance-profile-name "$NAME" --role-name "$NAME"
  echo "  (waiting for the new instance profile to propagate)"
  sleep 15
fi

echo "→ Security group: 80 and 443 from anywhere, nothing else (shell access is via Session Manager)"
VPC=$(aws ec2 describe-vpcs --filters Name=isDefault,Values=true --query 'Vpcs[0].VpcId' --output text)
[ "$VPC" != "None" ] || { echo "No default VPC in $REGION; create one or set up a VPC first." >&2; exit 1; }
SG=$(aws ec2 describe-security-groups --filters Name=group-name,Values="$NAME" Name=vpc-id,Values="$VPC" --query 'SecurityGroups[0].GroupId' --output text)
if [ "$SG" = "None" ]; then
  SG=$(aws ec2 create-security-group --group-name "$NAME" --description "Clash of Pokemons game server" --vpc-id "$VPC" --query GroupId --output text)
  for port in 80 443; do
    aws ec2 authorize-security-group-ingress --group-id "$SG" --protocol tcp --port "$port" --cidr 0.0.0.0/0 >/dev/null
    aws ec2 authorize-security-group-ingress --group-id "$SG" --ip-permissions "IpProtocol=tcp,FromPort=$port,ToPort=$port,Ipv6Ranges=[{CidrIpv6=::/0}]" >/dev/null
  done
fi

echo "→ Instance ($INSTANCE_TYPE, Amazon Linux 2023 arm64) bootstrapping $REPO_URL@$GIT_REF"
AMI=$(aws ssm get-parameter --name /aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-arm64 --query Parameter.Value --output text)
USER_DATA=$(mktemp)
sed -e "s#__REPO_URL__#$REPO_URL#" -e "s#__GIT_REF__#$GIT_REF#" -e "s#__DOMAIN__#$DOMAIN#" -e "s#__PARAM_PREFIX__#$PARAM_PREFIX#" \
  "$HERE/bootstrap.sh" > "$USER_DATA"
INSTANCE=$(aws ec2 run-instances --image-id "$AMI" --instance-type "$INSTANCE_TYPE" \
  --iam-instance-profile Name="$NAME" --security-group-ids "$SG" \
  --metadata-options HttpTokens=required,HttpEndpoint=enabled \
  --block-device-mappings 'DeviceName=/dev/xvda,Ebs={VolumeSize=20,VolumeType=gp3,Encrypted=true}' \
  --user-data "file://$USER_DATA" \
  --tag-specifications "ResourceType=instance,Tags=[{Key=Name,Value=$NAME}]" \
  --query 'Instances[0].InstanceId' --output text)
rm "$USER_DATA"
aws ec2 wait instance-running --instance-ids "$INSTANCE"

echo "→ Elastic IP"
ALLOC=$(aws ec2 allocate-address --domain vpc --tag-specifications "ResourceType=elastic-ip,Tags=[{Key=Name,Value=$NAME}]" --query AllocationId --output text)
aws ec2 associate-address --instance-id "$INSTANCE" --allocation-id "$ALLOC" >/dev/null
IP=$(aws ec2 describe-addresses --allocation-ids "$ALLOC" --query 'Addresses[0].PublicIp' --output text)

cat <<DONE

Done. Instance $INSTANCE in $REGION, Elastic IP $IP.

Next:
  1. DNS: add an A record  $DOMAIN → $IP  (Caddy gets the HTTPS certificate once it resolves).
  2. Wait ~5 minutes for the first build, then:  curl https://$DOMAIN/health   → {"ok":true}
  3. Vercel: set VITE_SERVER_URL=https://$DOMAIN and redeploy the client.

Logs / shell (no SSH needed):  aws ssm start-session --region $REGION --target $INSTANCE
  sudo tail -f /var/log/cop-bootstrap.log
  sudo docker compose -f /opt/cop/deploy/aws/docker-compose.yml logs -f server
Redeploy after pushing:  sudo /opt/cop/deploy/aws/update.sh [git-ref]
DONE
