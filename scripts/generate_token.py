#!/usr/bin/env python3
"""
One-time local setup: generate the Google OAuth token for Home-Base.

Run this on your laptop (requires a browser):
    python scripts/generate_token.py

It opens a browser tab where you log in as ncduncan@gmail.com and grant
the requested permissions. The resulting token.json is written to the
project root and is self-contained (includes the refresh token and client
credentials needed for automatic renewal in GitHub Actions).

After running this script, encode the token for GitHub:
    # Linux:
    base64 -w 0 token.json
    # macOS:
    base64 -i token.json

Store that base64 string as the GOOGLE_OAUTH_TOKEN GitHub Actions secret.
Then delete your local token.json (it's in .gitignore, but belt-and-suspenders).
"""

import sys
from pathlib import Path

# Run from project root so imports work
sys.path.insert(0, str(Path(__file__).parent.parent))

CLIENT_SECRETS_FILE = Path("client_secret.json")
TOKEN_OUTPUT = Path("token.json")

SCOPES = [
    "https://www.googleapis.com/auth/calendar.readonly",
    "https://www.googleapis.com/auth/calendar.events",
    "https://www.googleapis.com/auth/gmail.send",
]


def main() -> None:
    if not CLIENT_SECRETS_FILE.exists():
        print("ERROR: client_secret.json not found in the project root.")
        print()
        print("To get it:")
        print("  1. Go to https://console.cloud.google.com/")
        print("  2. Create or select a project (e.g. 'home-base')")
        print("  3. Enable APIs:")
        print("       - Google Calendar API")
        print("       - Gmail API")
        print("  4. Go to Credentials → Create Credentials → OAuth 2.0 Client ID")
        print("       Application type: Desktop app")
        print("  5. Download the JSON → save as client_secret.json here")
        print()
        print("Then re-run this script.")
        sys.exit(1)

    try:
        from google_auth_oauthlib.flow import InstalledAppFlow
    except ImportError:
        print("ERROR: google-auth-oauthlib is not installed.")
        print("Run: pip install -e .")
        sys.exit(1)

    print("Home-Base OAuth Setup")
    print("=" * 40)
    print(f"Scopes: {', '.join(SCOPES)}")
    print()
    print("A browser window will open. Log in as ncduncan@gmail.com")
    print("and grant the requested permissions.")
    print()

    flow = InstalledAppFlow.from_client_secrets_file(
        str(CLIENT_SECRETS_FILE),
        scopes=SCOPES,
    )
    creds = flow.run_local_server(port=0)

    with open(TOKEN_OUTPUT, "w") as f:
        f.write(creds.to_json())

    print(f"\n✅  Token saved to {TOKEN_OUTPUT}")
    print()
    print("Next: encode and store as a GitHub Actions secret.")
    print()
    print("  Linux:")
    print(f"    base64 -w 0 {TOKEN_OUTPUT}  # copy the output")
    print()
    print("  macOS:")
    print(f"    base64 -i {TOKEN_OUTPUT}    # copy the output")
    print()
    print("Store that value as: GOOGLE_OAUTH_TOKEN  (GitHub repo → Settings → Secrets)")
    print()
    print("⚠️   token.json is in .gitignore — never commit it.")
    print("    You can delete it locally once it's saved as a GitHub secret.")


if __name__ == "__main__":
    main()
