#!/usr/bin/env bash
# Home-Base: one-shot GitHub secrets setup
#
# Run this from the project root AFTER you have:
#   1. Completed the Google OAuth flow  (token.json exists here)
#   2. Collected your Asana PAT, OpenWeatherMap key, and Anthropic API key
#
#   bash scripts/setup_secrets.sh

set -euo pipefail

REPO="ncduncan/home-base"
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
RESET='\033[0m'

ok()   { echo -e "${GREEN}  ✓ $1${RESET}"; }
warn() { echo -e "${YELLOW}  ⚠ $1${RESET}"; }
die()  { echo -e "${RED}  ✗ $1${RESET}"; exit 1; }

echo ""
echo "Home-Base — GitHub Secrets Setup"
echo "================================="
echo ""

# ── Preflight checks ────────────────────────────────────────────────────────
command -v gh   &>/dev/null || die "gh CLI not found. Install: https://cli.github.com/"
command -v python3 &>/dev/null || die "python3 not found."

gh auth status &>/dev/null || die "Not logged in to gh. Run: gh auth login"
ok "gh CLI authenticated"

[ -f "token.json" ] || die "token.json not found. Run: python scripts/generate_token.py"
ok "token.json present"

echo ""

# ── Google OAuth token ───────────────────────────────────────────────────────
echo "Encoding Google OAuth token..."
# Cross-platform base64 (macOS vs Linux differ on line-wrap flag)
if base64 --version 2>&1 | grep -q GNU; then
    TOKEN_B64=$(base64 -w 0 token.json)
else
    TOKEN_B64=$(base64 -i token.json | tr -d '\n')
fi
gh secret set GOOGLE_OAUTH_TOKEN --body "$TOKEN_B64" --repo "$REPO"
ok "GOOGLE_OAUTH_TOKEN set"

echo ""

# ── Asana PAT ────────────────────────────────────────────────────────────────
echo "Asana Personal Access Token"
echo "  Get yours at: https://app.asana.com/0/my-apps  (+ icon → Personal access token)"
echo -n "  Paste token: "
read -rs ASANA_PAT
echo ""
gh secret set ASANA_PAT --body "$ASANA_PAT" --repo "$REPO"
ok "ASANA_PAT set"

# Auto-fetch workspace GID
echo ""
echo "Fetching your Asana workspaces..."
WORKSPACE_JSON=$(curl -s -H "Authorization: Bearer $ASANA_PAT" \
    "https://app.asana.com/api/1.0/workspaces")

WORKSPACE_COUNT=$(echo "$WORKSPACE_JSON" | python3 -c \
    "import sys,json; d=json.load(sys.stdin)['data']; print(len(d))" 2>/dev/null || echo "0")

if [ "$WORKSPACE_COUNT" = "0" ]; then
    warn "Could not fetch workspaces. Check your PAT."
    echo -n "  Enter workspace GID manually: "
    read -r WORKSPACE_GID
else
    echo ""
    echo "$WORKSPACE_JSON" | python3 -c \
        "import sys,json; [print(f'  [{i+1}] {w[\"gid\"]}  {w[\"name\"]}') \
         for i,w in enumerate(json.load(sys.stdin)['data'])]"
    echo ""

    WORKSPACE_GID=$(echo "$WORKSPACE_JSON" | python3 -c \
        "import sys,json; print(json.load(sys.stdin)['data'][0]['gid'])")

    if [ "$WORKSPACE_COUNT" = "1" ]; then
        ok "Auto-selected workspace GID: $WORKSPACE_GID"
    else
        echo -n "  Enter GID from list above: "
        read -r WORKSPACE_GID
    fi
fi

gh secret set ASANA_WORKSPACE_GID --body "$WORKSPACE_GID" --repo "$REPO"
ok "ASANA_WORKSPACE_GID set ($WORKSPACE_GID)"

echo ""

# ── OpenWeatherMap ───────────────────────────────────────────────────────────
echo "OpenWeatherMap API key"
echo "  Free account: https://home.openweathermap.org/api_keys"
echo "  (Free tier works — the agent falls back to the 5-day API if needed)"
echo -n "  Paste key: "
read -rs OWM_KEY
echo ""
gh secret set OPENWEATHERMAP_API_KEY --body "$OWM_KEY" --repo "$REPO"
ok "OPENWEATHERMAP_API_KEY set"

echo ""

# ── Anthropic ────────────────────────────────────────────────────────────────
echo "Anthropic API key"
echo "  Get yours at: https://console.anthropic.com/settings/keys"
echo -n "  Paste key: "
read -rs ANTHROPIC_KEY
echo ""
gh secret set ANTHROPIC_API_KEY --body "$ANTHROPIC_KEY" --repo "$REPO"
ok "ANTHROPIC_API_KEY set"

echo ""
echo "================================="
ok "All 5 secrets set on $REPO"
echo ""

# ── Optional: trigger test run ────────────────────────────────────────────────
echo "Run a test now? (dry run — prints briefing, no email or calendar events sent)"
echo -n "  [y/N]: "
read -r TRIGGER
if [[ "$TRIGGER" =~ ^[Yy]$ ]]; then
    gh workflow run weekly_briefing.yml \
        --repo "$REPO" \
        --field BRIEFING_DRY_RUN=true 2>/dev/null || \
    gh workflow run weekly_briefing.yml --repo "$REPO"
    echo ""
    ok "Workflow triggered!"
    echo "  Watch it run: https://github.com/$REPO/actions"
else
    echo ""
    echo "  Trigger manually any time:"
    echo "  → https://github.com/$REPO/actions"
    echo "  → Actions → 'Home-Base Weekly Briefing' → Run workflow"
fi

echo ""
