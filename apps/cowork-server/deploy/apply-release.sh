#!/usr/bin/env bash
# Existing Linux/systemd installation only. Preserve config/data; revert on failure.
# sudo ./deploy/apply-release.sh /path/cowork-release /opt/cowork-server [service]
set -euo pipefail
release="${1:?release directory required}"
dest="${2:?existing deployment directory required}"
service="${3:-cowork-server}"
[ "$(uname -s)" = Linux ] && [ "$(id -u)" = 0 ] || { echo 'Linux root required'; exit 1; }
[[ "$dest" = /* && "$dest" != / && "$dest" != */ && "$dest" != *'/../'* ]] || { echo 'Invalid deployment directory'; exit 1; }
[[ "$service" =~ ^[a-zA-Z0-9_-]+$ ]] || { echo 'Invalid service name'; exit 1; }
[ -d "$dest" ] && [ ! -L "$dest" ] && [ -f "$dest/.env" ] && [ ! -L "$dest/.env" ] || { echo 'Existing installation/config required'; exit 1; }
node "$release/deploy/verify-release.mjs" "$release"
systemctl is-active --quiet "$service"
[ "$(systemctl show -p WorkingDirectory --value "$service")" = "$dest" ] || { echo 'Service WorkingDirectory does not match deployment directory'; exit 1; }
# Mutable account state must stay outside the directory being replaced.
node - "$dest" <<'NODE'
const fs=require('node:fs'),path=require('node:path'),root=process.argv[2];
const env=fs.readFileSync(path.join(root,'.env'),'utf8');
const value=env.match(/^COWORK_STATE_DIR=(.*)$/m)?.[1]?.trim().replace(/^['"]|['"]$/g,'')||'/data/cowork-state';
if(!path.isAbsolute(value)||path.resolve(value)===path.resolve(root)||path.resolve(value).startsWith(path.resolve(root)+'/'))throw new Error('Move mutable account state outside deployment directory before upgrade');
NODE
owner="$(stat -c '%u:%g' "$dest")"
stamp="$(date -u +%Y%m%dT%H%M%SZ)-$$"
next="${dest}.release-${stamp}"; backup="${dest}.bak-${stamp}"
mkdir "$next"
cp -a "$release/." "$next/"
cp -a "$dest/.env" "$next/.env"
chmod 600 "$next/.env"
copy_audit() {
  node - "$dest" "$next" <<'NODE'
const fs=require('node:fs'),path=require('node:path'),root=process.argv[2],next=process.argv[3];
const env=fs.readFileSync(path.join(root,'.env'),'utf8');
const value=env.match(/^COWORK_AUDIT_FILE=(.*)$/m)?.[1]?.trim().replace(/^['"]|['"]$/g,'')||'cowork-audit.log';
const original=path.resolve(root,value),relative=path.relative(root,original);
// Outside files remain in place across the source-directory replacement.
if(relative && relative!=='..' && !relative.startsWith('../') && !path.isAbsolute(relative) && fs.existsSync(original)){
 if(!fs.lstatSync(original).isFile())throw new Error('Audit source must be a regular file');
 const target=path.join(next,relative);fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(original,target);fs.chmodSync(target,fs.statSync(original).mode&0o777);
}
NODE
}
copy_audit
# Preserve local dependencies, then resolve the new pinned dependency requirements.
if [ -d "$dest/node_modules" ]; then cp -a "$dest/node_modules" "$next/"; fi
(cd "$next" && npm install --omit=dev --ignore-scripts --no-audit --no-fund)
chown -R "$owner" "$next"
node "$next/deploy/verify-release.mjs" "$next"
rollback() {
  trap - ERR
  systemctl stop "$service" || true
  if [ -d "$backup" ]; then
    if [ -d "$dest" ]; then mv "$dest" "${dest}.failed-${stamp}"; fi
    mv "$backup" "$dest"
  fi
  systemctl start "$service"
  echo "Upgrade failed; restored prior deployment. Failed snapshot: ${dest}.failed-${stamp}" >&2
  exit 1
}
trap rollback ERR
systemctl stop "$service"
# Re-copy the audit tail after stopping writes, not only the earlier snapshot.
copy_audit
mv "$dest" "$backup"
mv "$next" "$dest"
systemctl start "$service"
sleep 2
systemctl is-active --quiet "$service" || rollback
trap - ERR
echo "Service active; previous source/config retained at $backup"
echo 'Next: authenticated /ppt/capabilities check and real-user PPT acceptance.'
