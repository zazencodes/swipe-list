#!/bin/sh
# Build locally, sync the build to your server, restart the service, and check health.
# Settings come from deploy.env (copy deploy.env.example). The server's own .env is
# never synced; see docs/self-hosting.md.
set -eu
cd "$(dirname "$0")/.."

[ -f deploy.env ] || { echo "missing deploy.env: copy deploy.env.example and fill it in" >&2; exit 1; }
. ./deploy.env
: "${DEPLOY_HOST:?set DEPLOY_HOST in deploy.env}" "${API_DOMAIN:?set API_DOMAIN in deploy.env}"
: "${DASHBOARD_PORT:?set DASHBOARD_PORT in deploy.env}" "${AGENT_PORT:?set AGENT_PORT in deploy.env}"
DIR=/opt/swipe-list

npm run build
sed -e "s/__API_DOMAIN__/$API_DOMAIN/" -e "s/__AGENT_PORT__/$AGENT_PORT/" deploy/caddy/swipe-api.caddy > dist/swipe-api.caddy
# -rlptz is -a without owner/group, so files land owned by the ssh user (root);
# macOS's openrsync has no --chown.
rsync -rlptz --delete \
  --exclude .env \
  dist migrations scripts deploy skill package.json \
  "$DEPLOY_HOST:$DIR/"
ssh "$DEPLOY_HOST" "
  set -eu
  cp $DIR/deploy/swipe-list.service /etc/systemd/system/
  install -m 644 $DIR/dist/swipe-api.caddy /etc/caddy/sites/swipe-list.caddy
  systemctl daemon-reload
  systemctl enable swipe-list
  systemctl restart swipe-list
  systemctl reload caddy
  for i in \$(seq 1 20); do
    curl -fsS http://127.0.0.1:$DASHBOARD_PORT/healthz && curl -fsS http://127.0.0.1:$AGENT_PORT/healthz && echo && exit 0
    sleep 1
  done
  journalctl -u swipe-list -n 40 --no-pager
  exit 1
"
