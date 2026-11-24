# Self-hosting Swipe List

This guide takes you from nothing to a running Swipe List of your own: the
server, the phone dashboard, the `swipe` CLI and agent skill, the ingestion
worker on your Mac, and the Mac app. It is written so a coding agent can follow
it top to bottom; the steps that need you (accounts, sign-ins, DNS, the phone)
are marked **You:**.

Placeholders used throughout:

| Placeholder | Example | What it is |
| --- | --- | --- |
| `<server>` | `root@203.0.113.10` | ssh target of your Linux server |
| `<api-domain>` | `swipe-api.example.com` | public hostname for the agent API |
| `<dashboard-url>` | `https://myserver.tail1234.ts.net:9021` | the dashboard's address on your tailnet |
| `<you@example.com>` | | the email you sign in to the dashboard with |

## What you need

- **A Neon account.** The Free plan is enough to start: it includes Postgres,
  Object Storage (5 GB per project) and Neon Auth. Video takes space quickly;
  about 1,000 saved items is about 15 GB.
- **A small Linux server** you can ssh into as root, with a public IP (any VPS;
  1 GB of RAM is plenty). It runs Node.js 22 or newer installed system-wide at
  `/usr/bin/node`, Caddy, Tailscale, rsync and curl.
- **A computer to deploy from** (macOS or Linux) with git, ssh, rsync and
  Node.js 24 or newer: the dependencies need npm 11, which Node.js 24 ships.
- **A domain** where you can add a DNS record for `<api-domain>`.
- **A Tailscale account** (free), with the Tailscale app on your phone.
- **For the worker, a Mac** that is usually on, with:
  - the [Codex CLI](https://github.com/openai/codex), signed in, and its Chrome
    plugin connected to Chrome;
  - Google Chrome, running, signed in to the sites you save from;
  - FFmpeg (`brew install ffmpeg`) and Node.js 24 or newer;
  - [Koyomi](https://github.com/zazencodes/koyomi), which runs the worker every 5 minutes.
- **For the Mac app:** macOS 15 or later and the Xcode Command Line Tools.

The worker runs Codex with full access to the Mac user it runs as and drives
that user's logged-in Chrome. A web page could try to instruct it. Run the
worker under a separate macOS user with its own Chrome profile, signed in only
to the sites you save from. See
[the accepted-risk ADR](adr/2026-10-26-worker-runs-with-the-owners-privileges.md).

## 1. Get the code

On your own computer (the one you deploy from, macOS or Linux):

```sh
git clone https://github.com/zazencodes/swipe-list.git
cd swipe-list
npm install
```

## 2. Create the Neon project

**You:** create a Neon account at <https://neon.com> if you don't have one, then
sign the CLI in:

```sh
npx neon login
```

Create the project and provision the database, the `media` bucket and Neon Auth
from `neon.ts`. Pick the region nearest your server
(`npx neon link --help` lists them):

```sh
npx neon link --project-name swipe-list --region-id aws-us-east-2 -y
npx neon deploy -y
```

`.neon` now points at the project's `main` branch, which is production. Save its
connection variables to a file you will copy to the server:

```sh
umask 077
env_dir=$(mktemp -d)
server_env="$env_dir/server.env"
npx neon env pull --branch main --file "$server_env"
```

## 3. Lock down sign-in

Only your email may sign in to the dashboard. Create your user, turn off sign-up,
and remove the shared Google sign-in that Neon Auth starts with:

```sh
npx neon neon-auth user create --branch main --email <you@example.com>
npx neon neon-auth config email-password update --branch main --disable-sign-up
npx neon neon-auth oauth-provider delete --branch main --provider-id google
```

`npx neon neon-auth plugins list --branch main` should now show
`oauth_providers 0 items`. Step 6 adds the dashboard's address as a trusted
domain once you know it.

## 4. Prepare the server

**You:** point an `A` record for `<api-domain>` at the server's public IP. If you
use Cloudflare, leave the proxy off (DNS only) so Caddy can get a certificate.

Then, on the server (Debian or Ubuntu shown):

```sh
apt-get update && apt-get install -y rsync curl
# Node.js 22 or newer as a system package (the service runs /usr/bin/node), Caddy and
# Tailscale, from their official instructions:
#   https://github.com/nodesource/distributions  https://caddyserver.com/docs/install  https://tailscale.com/download/linux
command -v node && node --version   # /usr/bin/node, v22 or newer

useradd --system --home /opt/swipe-list --shell /usr/sbin/nologin swipe
mkdir -p /opt/swipe-list /etc/caddy/sites
grep -q 'import /etc/caddy/sites/\*' /etc/caddy/Caddyfile || echo 'import /etc/caddy/sites/*' >> /etc/caddy/Caddyfile
```

**You:** run `tailscale up` on the server and sign in, and in the Tailscale admin
console turn on MagicDNS and HTTPS certificates.

Write the server's environment. Use the private temporary file from step 2 in the same deploy shell and add the
app variables from `.env.example`:

```sh
cat >> "$server_env" <<EOF
AUTH_COOKIE_SECRET=$(openssl rand -base64 32)
OWNER_EMAILS=<you@example.com>
MEDIA_BUCKET=media
HOST=127.0.0.1
DASHBOARD_PORT=9021
AGENT_PORT=9022
AGENT_URL=https://<api-domain>
DASHBOARD_URL=<dashboard-url>
EOF
ssh <server> 'umask 077; cat > /opt/swipe-list/.env && chown root:swipe /opt/swipe-list/.env && chmod 640 /opt/swipe-list/.env' < "$server_env"
rm "$server_env" && rmdir "$env_dir"
```

`<dashboard-url>` is `https://<the server's MagicDNS name>:9021`; `tailscale status`
on the server shows the name. The server refuses to start if any variable is
missing.

## 5. Deploy

```sh
cp deploy.env.example deploy.env   # then set DEPLOY_HOST=<server> and API_DOMAIN=<api-domain>
./scripts/deploy.sh
```

The script builds everything, syncs it to `/opt/swipe-list`, installs the
systemd unit and the Caddy site, restarts the service and checks `/healthz` on
both listeners. Migrations run when the server starts. Check the public API:

```sh
curl -fsS https://<api-domain>/healthz   # {"ok":true}
```

## 6. Open the dashboard on the tailnet

On the server, publish the dashboard listener to your tailnet only:

```sh
tailscale serve --bg --https=9021 http://127.0.0.1:9021
```

Trust that address for sign-in, and stop accepting sign-ins from localhost:

```sh
npx neon neon-auth domain add --branch main <dashboard-url>
npx neon neon-auth domain allow-localhost disable --branch main
```

**You:** on your phone, turn Tailscale on, open `<dashboard-url>`, enter your
email and the code it sends you. Then Share → Add to Home Screen.

## 7. Make a credential

Agents, the CLI, the worker and the Mac app each use a credential. Make one per
machine or agent; the token is shown once:

```sh
ssh <server> 'cd /opt/swipe-list && runuser -u swipe -- node --env-file=.env dist/admin.mjs credentials create <name>'
```

A standard credential can browse the library. When creating a credential for a Mac app or agent you trust to queue work for the signed-in browser, append `--allow-submit` to the create command. For the dedicated processing account, use `credentials create mac-worker --worker`. Give that token only to the worker. Paste each token at its client's hidden login prompt.

`credentials list` and `credentials revoke <name>` manage them.

## 8. Install the CLI and the skill

On each machine whose agent should use your library (`swipe` needs Node.js 22
or newer there), give the installer the directory that agent loads skills from
(for example `~/.claude/skills` or `~/.agents/skills`). It installs `swipe` to
`~/.local/bin` and the `inspo-swipe-list` skill. Read the script first if you
like: it is `scripts/install-client.sh`, served with your URL filled in.

```sh
curl -fsSL https://<api-domain>/install.sh -o /tmp/swipe-install.sh
sh /tmp/swipe-install.sh <skills-dir>
swipe login --url https://<api-domain>
swipe whoami
```

`swipe whoami` prints the credential's name and `dashboard_url`.

## 9. Run the worker

On the Mac, as the user the worker runs as (see the warning under
[What you need](#what-you-need)):

1. **You:** sign in to Codex (`codex login`), install Codex's Chrome plugin and
   connect it to Chrome, and sign in to the sites you save from in that Chrome.
2. Get the code and sign in with a credential made for the worker (step 7, for
   example `mac-worker`):

   ```sh
   git clone https://github.com/zazencodes/swipe-list.git ~/swipe-list
   cd ~/swipe-list && npm install
   curl -fsSL https://<api-domain>/install.sh -o /tmp/swipe-install.sh && sh /tmp/swipe-install.sh ~/.agents/skills
   swipe login --url https://<api-domain>
   ```

3. Queue a screenshot from the owner dashboard. In the worker account, process it:

   ```sh
   npm run -s worker
   swipe search --status done
   ```

4. Schedule it with Koyomi (set Koyomi up first, from its README):

   ```sh
   koyomi add swipe-list-worker --every 5m --cwd ~/swipe-list --cmd 'npm run -s worker' \
     --timeout 2h --description 'Swipe List: pull and describe queued items'
   ```

Each run claims items one at a time until the queue is empty, up to 20 per run;
a run with nothing queued is one HTTP call. When an item fails the run exits 1,
so Koyomi alerts you. Read the reason with `swipe search --status failed`, then
`swipe retry <id>`. For a failed item, read the local diagnostics in `~/.swipe-list/work/<item>-<run>/`. The agent’s input and output files are in its `job/` subdirectory.

## 10. Install the Mac app

```sh
cd macos && ./install.sh
```

It builds the app, installs it to `/Applications` and opens it. On first launch
press **Use Swipe CLI connection** if `swipe` is signed in on this Mac, or paste
`https://<api-domain>` and a credential. The build is signed ad hoc, so macOS
asks for Keychain access again after each rebuild; with an Apple Development
identity, build with `SWIPE_LIST_SIGN_IDENTITY="Apple Development"` instead.

## Check

```sh
swipe whoami                    # answers with your credential and dashboard_url
swipe search --status done      # lists the item the worker processed
koyomi show swipe-list-worker   # enabled, with a successful last run
```

**You:** the dashboard opens on your phone and shows the same item.

## Update

```sh
git pull && npm install && ./scripts/deploy.sh          # the server
cd ~/swipe-list && git pull && npm install              # the worker Mac
curl -fsSL https://<api-domain>/install.sh -o /tmp/swipe-install.sh && sh /tmp/swipe-install.sh <skills-dir>   # CLI and skill
cd macos && ./install.sh                                # the Mac app
```

Read `CHANGELOG.md` first. A release that needs more than this says so there.

## Remove

```sh
koyomi delete swipe-list-worker
rm -rf ~/swipe-list ~/.swipe-list ~/.config/swipe ~/.local/bin/swipe <skills-dir>/inspo-swipe-list
rm -rf "/Applications/Swipe List.app"
security delete-generic-password -s com.zazencodes.swipelist -a credential   # the Mac app's credential
ssh <server> 'systemctl disable --now swipe-list && rm /etc/systemd/system/swipe-list.service /etc/caddy/sites/swipe-list.caddy && systemctl reload caddy && tailscale serve --https=9021 off && rm -rf /opt/swipe-list && userdel swipe'
npx neon projects delete <project id>    # deletes the library and every file in it, for good
```

`npx neon projects list` shows the project id.
