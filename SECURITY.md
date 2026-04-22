# Security Policy

Compound is intended for private knowledge work. Treat the application, SQLite data, GitHub sync token, and LLM API keys as sensitive.

## Production checklist

- Set `COMPOUND_ADMIN_TOKEN` or `ADMIN_TOKEN` to a strong random secret.
- Do not deploy publicly without auth.
- Use a fine-grained GitHub token with Contents: Read-only only.
- Store SQLite data under a persistent private volume.
- Do not commit `.env`, database files, or exported note content.
- Rotate any token that was pasted into chat, logs, issues, or screenshots.

## LLM endpoint policy

If a browser user supplies a custom LLM API URL, they must also supply their own API key. Compound will not send the server-side `LLM_API_KEY` to a user-supplied URL.

Set this to disable custom user API URLs entirely:

```bash
COMPOUND_ALLOW_CUSTOM_LLM_API_URL=false
```

## Reporting issues

This is currently a private/single-user-oriented project. Please report vulnerabilities privately to the repository owner before public disclosure.
