#!/usr/bin/env bash
# Write the public RPS addresses into .env.local. Other keys in that file are left alone.
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/../.." && pwd)
JSON="$ROOT/contracts/broadcast/local.json"
RPC="${RPC:-http://127.0.0.1:8545}"
ENV_FILE="$ROOT/.env.local"

if [[ ! -f "$JSON" ]]; then
  echo "Missing $JSON. Run npm run chain:deploy first." >&2
  exit 1
fi

ROOT="$ROOT" JSON="$JSON" RPC="$RPC" ENV_FILE="$ENV_FILE" python3 - <<'PY'
import json, os, re
from pathlib import Path

def write_env(path: Path, updates: dict[str, str]) -> None:
    lines = path.read_text().splitlines() if path.exists() else []
    seen: set[str] = set()
    out: list[str] = []
    for line in lines:
        match = re.match(r"^([A-Za-z_][A-Za-z0-9_]*)=", line)
        if match and match.group(1) in updates:
            key = match.group(1)
            if key not in seen:
                out.append(f"{key}={updates[key]}")
                seen.add(key)
            continue
        out.append(line)
    for key, value in updates.items():
        if key not in seen:
            out.append(f"{key}={value}")
    path.write_text("\n".join(out).rstrip() + "\n")

data = json.loads(Path(os.environ["JSON"]).read_text())
rpc = os.environ["RPC"]
vite = {
    "VITE_RPS_CHAIN_ID": str(data["chainId"]),
    "VITE_RPS_RPC_URL": rpc,
    "VITE_RPS_ADDRESS": data["rps"],
    "VITE_USDC_ADDRESS": data["usdc"],
}
env_file = Path(os.environ["ENV_FILE"])
write_env(env_file, vite)
print(f"wrote {env_file}")
for key, value in vite.items():
    print(f"  {key}={value}")

server_env = Path(os.environ["ROOT"]) / ".env"
if server_env.exists():
    write_env(server_env, {"RPS_RPC_URL": rpc})
    print(f"updated {server_env} RPS_RPC_URL")
else:
    print("Left .env alone because it does not exist. The server does not read .env.local.")
    print("Local Anvil is already allowed on /rps. Set RPS_RPC_URL in .env only for another RPC.")
PY
