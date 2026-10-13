#!/usr/bin/env bash
set -euo pipefail
[[ $EUID -eq 0 ]] || { echo '请用 sudo bash install.sh 执行'; exit 1; }
DOMAIN=${1:-condition-lab.jobgrowthos.cn}
[[ "$DOMAIN" =~ ^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$ ]] || { echo '域名格式错误'; exit 1; }
BASE=$(cd -- "$(dirname -- "$0")" && pwd)
APP=/opt/condition-lab
UNIT=/etc/systemd/system/condition-lab.service
CONF=/etc/nginx/sites-available/condition-lab
LINK=/etc/nginx/sites-enabled/condition-lab
NODE=$(command -v node || true)
[[ -n "$NODE" ]] || { echo '缺少 Node.js，需要 22.13 或更新版本'; exit 1; }
"$NODE" -e 'const [a,b]=process.versions.node.split(".").map(Number);if(a<22||(a===22&&b<13))process.exit(1)'
for c in nginx systemctl curl ss; do command -v "$c" >/dev/null; done
for f in "$APP" "$UNIT" "$CONF" "$LINK"; do [[ ! -e "$f" && ! -L "$f" ]] || { echo "已存在 $f，停止以免覆盖"; exit 1; }; done
[[ -f "$BASE/server.mjs" && -f "$BASE/web/index.html" ]] || { echo '请在完整部署包中运行'; exit 1; }
if ss -ltnH 'sport = :4319' | read -r _; then echo '4319 端口已占用，停止'; exit 1; fi
if nginx -T 2>/dev/null | grep -Fq "$DOMAIN"; then echo '该域名已有 Nginx 配置，停止'; exit 1; fi
nginx -t
if ! id condition-lab >/dev/null 2>&1; then useradd --system --no-create-home --shell /usr/sbin/nologin condition-lab; fi
install -d -m 755 "$APP"
cp "$BASE/server.mjs" "$APP/server.mjs"
cp -R "$BASE/web" "$APP/web"
chown -R root:root "$APP"
cat > "$UNIT" <<SERVICE
[Unit]
Description=Condition Lab
After=network.target
[Service]
User=condition-lab
Group=condition-lab
WorkingDirectory=$APP
ExecStart=$NODE $APP/server.mjs
Environment=NODE_ENV=production
Environment=HOST=127.0.0.1
Environment=PORT=4319
EnvironmentFile=-/etc/condition-lab.env
Restart=on-failure
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
[Install]
WantedBy=multi-user.target
SERVICE
systemctl daemon-reload
systemctl enable --now condition-lab
for attempt in 1 2 3 4 5; do curl -fsS http://127.0.0.1:4319/healthz >/dev/null && break; sleep 1; done
curl -fsS http://127.0.0.1:4319/healthz
cat > "$CONF" <<NGINX
server {
    listen 80;
    server_name $DOMAIN;
    client_max_body_size 16k;
    add_header X-Content-Type-Options nosniff always;
    location / {
        proxy_pass http://127.0.0.1:4319;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 25s;
    }
}
NGINX
ln -s "$CONF" "$LINK"
if ! nginx -t; then unlink "$LINK"; echo '新配置检查失败，未重载 Nginx；保留文件供修复'; exit 1; fi
systemctl reload nginx
curl -fsS -H "Host: $DOMAIN" http://127.0.0.1/healthz
printf '\nHTTP 入口已配置。确认 DNS 后配置 HTTPS，再验收公开访问。\n'
