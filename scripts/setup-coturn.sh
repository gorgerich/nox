#!/usr/bin/env bash
#
# Nox — one-shot coturn (STUN + TURN) setup for Ubuntu 22.04 / 24.04.
#
# Run as root on a FRESH VPS that has:
#   - a public IPv4 address
#   - a DNS A-record (e.g. turn.example.com) already pointing to this server
#
# Usage (fill the 4 values):
#   sudo TURN_DOMAIN=turn.example.com \
#        TURN_USER=noxturn \
#        TURN_PASSWORD='PUT_A_LONG_RANDOM_STRING_HERE' \
#        [email protected] \
#        bash setup-coturn.sh
#
# Optional overrides:
#   TURN_REALM=example.com          (default: TURN_DOMAIN)
#   EXTERNAL_IP=1.2.3.4             (default: auto-detected)
#   MIN_PORT=49152 MAX_PORT=49999   (relay UDP port range)
#
# After it finishes it prints the exact NEXT_PUBLIC_TURN_* values to paste into
# Nox env. Remember: those are baked at `npm run build`, so set them, THEN build.

set -euo pipefail

# ---- required params -------------------------------------------------------
: "${TURN_DOMAIN:?set TURN_DOMAIN (must already resolve to THIS server)}"
: "${TURN_USER:?set TURN_USER}"
: "${TURN_PASSWORD:?set TURN_PASSWORD (use a long random string, 24+ chars)}"
TURN_REALM="${TURN_REALM:-$TURN_DOMAIN}"
LETSENCRYPT_EMAIL="${LETSENCRYPT_EMAIL:-}"
MIN_PORT="${MIN_PORT:-49152}"
MAX_PORT="${MAX_PORT:-49999}"

if [ "$(id -u)" != "0" ]; then
  echo "Run as root (use sudo)." >&2
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y coturn certbot curl ufw

# ---- detect public IP ------------------------------------------------------
EXTERNAL_IP="${EXTERNAL_IP:-$(curl -fsS https://api.ipify.org || true)}"
: "${EXTERNAL_IP:?could not auto-detect public IP; re-run with EXTERNAL_IP=your.ip}"
echo ">> Public IP: $EXTERNAL_IP   Domain: $TURN_DOMAIN"

# ---- sanity: does the domain resolve to us? (warn only) --------------------
RESOLVED="$(getent hosts "$TURN_DOMAIN" | awk '{print $1}' | head -1 || true)"
if [ -n "$RESOLVED" ] && [ "$RESOLVED" != "$EXTERNAL_IP" ]; then
  echo "!! WARNING: $TURN_DOMAIN resolves to $RESOLVED, not $EXTERNAL_IP."
  echo "!! Fix the DNS A-record or TLS (turns:) will fail. Continuing anyway."
fi

# ---- firewall --------------------------------------------------------------
ufw allow OpenSSH        >/dev/null 2>&1 || true
ufw allow 80/tcp         >/dev/null 2>&1 || true   # certbot
ufw allow 3478/tcp       >/dev/null 2>&1 || true
ufw allow 3478/udp       >/dev/null 2>&1 || true
ufw allow 5349/tcp       >/dev/null 2>&1 || true   # TLS
ufw allow 5349/udp       >/dev/null 2>&1 || true
ufw allow "${MIN_PORT}:${MAX_PORT}/udp" >/dev/null 2>&1 || true
yes | ufw enable         >/dev/null 2>&1 || true

# ---- TLS certificate (Let's Encrypt, standalone; needs port 80 free) -------
HAVE_TLS=0
if [ -n "$LETSENCRYPT_EMAIL" ]; then
  systemctl stop coturn >/dev/null 2>&1 || true
  if certbot certonly --standalone --non-interactive --agree-tos \
       -m "$LETSENCRYPT_EMAIL" -d "$TURN_DOMAIN" \
       --deploy-hook "systemctl reload coturn"; then
    HAVE_TLS=1
  else
    echo "!! certbot failed — will run TURN without TLS (turns:). You can re-run later."
  fi
fi
CERT="/etc/letsencrypt/live/$TURN_DOMAIN/fullchain.pem"
PKEY="/etc/letsencrypt/live/$TURN_DOMAIN/privkey.pem"
[ -f "$CERT" ] && HAVE_TLS=1

# ---- enable daemon ---------------------------------------------------------
echo 'TURNSERVER_ENABLED=1' > /etc/default/coturn

# ---- config ----------------------------------------------------------------
cat > /etc/turnserver.conf <<EOF
# Managed by Nox setup-coturn.sh
listening-port=3478
tls-listening-port=5349
listening-ip=0.0.0.0
external-ip=$EXTERNAL_IP
min-port=$MIN_PORT
max-port=$MAX_PORT

fingerprint
lt-cred-mech
realm=$TURN_REALM
user=$TURN_USER:$TURN_PASSWORD

# hardening
no-cli
no-loopback-peers
no-multicast-peers
stale-nonce=600
no-tlsv1
no-tlsv1_1
# block relaying to private ranges (prevents SSRF abuse of the TURN server)
denied-peer-ip=0.0.0.0-0.255.255.255
denied-peer-ip=10.0.0.0-10.255.255.255
denied-peer-ip=127.0.0.0-127.255.255.255
denied-peer-ip=169.254.0.0-169.254.255.255
denied-peer-ip=172.16.0.0-172.31.255.255
denied-peer-ip=192.168.0.0-192.168.255.255
EOF

if [ "$HAVE_TLS" = "1" ]; then
  cat >> /etc/turnserver.conf <<EOF

cert=$CERT
pkey=$PKEY
EOF
fi

# ---- start -----------------------------------------------------------------
systemctl enable coturn >/dev/null 2>&1 || true
systemctl restart coturn
sleep 1
systemctl --no-pager --lines=0 status coturn || true

# ---- output env ------------------------------------------------------------
TURN_URLS="turn:$TURN_DOMAIN:3478?transport=udp,turn:$TURN_DOMAIN:3478?transport=tcp"
if [ "$HAVE_TLS" = "1" ]; then
  TURN_URLS="$TURN_URLS,turns:$TURN_DOMAIN:5349?transport=tcp"
fi

cat <<EOF

============================================================
 coturn is running. Put these into your Nox environment,
 then REBUILD (NEXT_PUBLIC_* is baked at build time):
============================================================
NEXT_PUBLIC_TURN_URLS=$TURN_URLS
NEXT_PUBLIC_TURN_USERNAME=$TURN_USER
NEXT_PUBLIC_TURN_CREDENTIAL=$TURN_PASSWORD
============================================================
 Verify externally (from your laptop, not the server):
 https://webrtc.github.io/samples/src/content/peerconnection/trickle-ice/
 Add turn:$TURN_DOMAIN:3478 + user/pass, "Gather candidates".
 You must see candidates of type "relay". If yes — TURN works.
============================================================
EOF
