#!/usr/bin/env bash
# Setup a Cloudflare Named Tunnel for Threads Auto-Poster.
# Usage: bash scripts/setup-cloudflare-tunnel.sh <subdomain> <domain>
#
# Prasyarat: npx (sudah ada di project ini)

set -euo pipefail

SUBDOMAIN="${1:-threads}"
DOMAIN="${2:-}"
TUNNEL_NAME="${TUNNEL_NAME:-threads-auto-poster}"
CFG_DIR="$HOME/.cloudflared"
CFG="$CFG_DIR/config.yml"
PORT="${PORT:-4000}"

if [[ -z "$DOMAIN" ]]; then
  echo "Pemakaian: bash scripts/setup-cloudflare-tunnel.sh <subdomain> <domain>"
  echo "Contoh:    bash scripts/setup-cloudflare-tunnel.sh threads example.com"
  exit 1
fi

HOSTNAME="${SUBDOMAIN}.${DOMAIN}"

echo "==> Target hostname: https://${HOSTNAME}"
echo

# --- 1. Login Cloudflare (sekali saja, butuh klik izin di browser) ---
if [[ ! -f "$CFG_DIR/cert.pem" ]]; then
  echo "==> Belum login Cloudflare. Membuka browser untuk otorisasi..."
  echo "    Pilih domain '${DOMAIN}' lalu klik Authorize."
  npx --yes cloudflared tunnel login
else
  echo "==> Sudah login Cloudflare (cert.pem ada)."
fi

# --- 2. Buat tunnel (idempoten: pakai yang sudah ada kalau ada) ---
echo
if npx --yes cloudflared tunnel list 2>/dev/null | grep -q "$TUNNEL_NAME"; then
  echo "==> Tunnel '${TUNNEL_NAME}' sudah ada, dipakai ulang."
else
  echo "==> Membuat tunnel '${TUNNEL_NAME}'..."
  npx --yes cloudflared tunnel create "$TUNNEL_NAME"
fi

TUNNEL_ID=$(npx --yes cloudflared tunnel list --output json 2>/dev/null \
  | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const t=JSON.parse(d).find(x=>x.name==='$TUNNEL_NAME');console.log(t?t.id:'')})")

if [[ -z "$TUNNEL_ID" ]]; then
  echo "GAGAL: tidak bisa mendapatkan tunnel ID." >&2
  exit 1
fi
echo "==> Tunnel ID: ${TUNNEL_ID}"

# --- 3. Tulis config.yml ---
mkdir -p "$CFG_DIR"
CRED_FILE="$CFG_DIR/${TUNNEL_ID}.json"
cat > "$CFG" <<EOF
tunnel: ${TUNNEL_NAME}
credentials-file: ${CRED_FILE}

ingress:
  - hostname: ${HOSTNAME}
    service: http://localhost:${PORT}
  - service: http_status:404
EOF
echo "==> Config ditulis: ${CFG}"

# --- 4. Route DNS ---
echo
echo "==> Menambah DNS route ${HOSTNAME} ..."
if npx --yes cloudflared tunnel route dns "$TUNNEL_NAME" "$HOSTNAME" 2>&1; then
  echo "==> DNS route berhasil dibuat otomatis."
  DNS_AUTO=1
else
  echo
  echo "!!  DNS route GAGAL otomatis. Tambahkan manual di Cloudflare dashboard:"
  cat <<EOF

     Type:  CNAME
     Name:  ${SUBDOMAIN}
     Target: ${TUNNEL_ID}.cfargotunnel.com
     Proxy: Aktif (orange cloud)

EOF
  DNS_AUTO=0
fi

# --- 5. Update .env.local & .env.development ---
echo
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NEW_URI="https://${HOSTNAME}/api/auth/threads/callback"
for f in "$PROJECT_DIR/.env.local" "$PROJECT_DIR/.env.development"; do
  if [[ -f "$f" ]]; then
    node -e "
const fs=require('fs');const p='$f';
let s=fs.readFileSync(p,'utf8');
const re=/^THREADS_OAUTH_REDIRECT_URI=.*\$/m;
if(re.test(s)) s=s.replace(re,'THREADS_OAUTH_REDIRECT_URI=$NEW_URI');
else s=s.trimEnd()+'\nTHREADS_OAUTH_REDIRECT_URI=$NEW_URI\n';
fs.writeFileSync(p,s);
"
    echo "==> Diperbarui: $f"
  fi
done

# --- 6. Ringkasan ---
echo
echo "=============================================="
echo " SETUP SELESAI"
echo "=============================================="
echo
echo "URL tetap   : https://${HOSTNAME}"
echo "Redirect URI: $NEW_URI"
echo "Tunnel ID   : ${TUNNEL_ID}"
echo
echo "Langkah berikutnya:"
echo
echo "1. Daftarkan Redirect URI ini di Meta for Developers:"
echo "   Akses Threads API > Pengaturan > URL Callback Alihkan"
echo "   ${NEW_URI}"
echo
echo "2. Jalankan tunnel (biarkan menyala):"
echo "   npx cloudflared tunnel --config ${CFG} run ${TUNNEL_NAME}"
echo
echo "3. Restart app supaya env terbaca:"
echo "   npm run build && npm run start"
echo
if [[ "$DNS_AUTO" == "0" ]]; then
  echo "CATATAN: DNS harus ditambahkan manual (lihat petunjuk di atas)."
  echo
fi
echo "Verifikasi:"
echo "   curl -s https://${HOSTNAME}/ | grep -o '<title>[^<]*</title>'"
echo "   node check-oauth.mjs"
echo
