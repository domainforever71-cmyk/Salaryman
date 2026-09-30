"""admin_tools.py - flip an existing account's is_admin flag.

Run this locally, against your own database, never as part of the app
itself:

    python admin_tools.py alex          # make user "alex" an admin
    python admin_tools.py alex --revoke # take it back away

There is deliberately no hardcoded admin account or password anywhere in
this codebase - not here, not in app.py, not in models.py. This script only
ever flips a boolean on an account that already exists, using whatever
password that account's owner already set for themselves at signup. Nothing
it does is reachable over HTTP; it has to be run on the machine hosting the
database.

Why it matters: a hardcoded username/password baked into source is a
standing backdoor - anyone who ever sees this code (a collaborator, a public
repo, a leaked zip) gets permanent admin access, and it can't be rotated
without a code change and redeploy. A flag on a real, individually-owned
account can be granted or revoked per-user, doesn't leak a password, and
costs nothing to run again later on a different account.
"""
import sys

from app import app
from models import db, User
from astra_net import find_user


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    revoke = "--revoke" in sys.argv
    if not args:
        print("Usage: python admin_tools.py <username> [--revoke]")
        sys.exit(1)

    username = args[0]
    with app.app_context():
        user = find_user(username)
        if not user:
            print(f"No account named {username!r}.")
            sys.exit(1)
        user.is_admin = not revoke
        db.session.commit()
        state = "revoked from" if revoke else "granted to"
        print(f"Admin {state} {username!r}.")


if __name__ == "__main__":
    main()
