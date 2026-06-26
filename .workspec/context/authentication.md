# Authentication

Authentication uses short-lived JWT access tokens plus rotating refresh tokens.

## Rules

- Access tokens expire after 15 minutes.
- Refresh tokens are stored hashed (never plaintext) and rotate on every use.
- Password hashing uses Argon2id with per-user salts.
- Failed-login attempts are rate limited per account and per IP.

## Sessions

A session is identified by a refresh-token family. Detecting reuse of a
retired refresh token invalidates the entire family (replay protection).
