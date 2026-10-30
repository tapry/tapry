# Security

## Reporting a vulnerability

Please don't open a public issue. Use **"Report a vulnerability"** under the repository's
Security tab (GitHub private vulnerability reporting). Include what an attacker can do, and the
steps or request to reproduce it.

We aim to reply within a week. Once a fix is released, the advisory is published, crediting
you unless you'd rather not.

## Supported versions

Only the latest release gets security fixes while the project is at 0.x.

## Worth knowing when you self-host

- Guest links are bearer secrets: anyone with one can join while the host has the studio open.
  Rotate the link from the studio page to revoke it.
- Sign-up closes after the first (admin) account unless `ALLOW_SIGNUP=true`.
- `setup.sh` generates every secret randomly. Keep `deploy/compose/.env` private and out of
  backups that others can read.
- Media never goes into logs. Downloads use short-lived signed storage URLs.
