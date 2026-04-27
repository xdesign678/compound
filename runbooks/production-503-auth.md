# Production 503 or auth lockout

Compound intentionally fails closed in production when no admin token is
configured. This protects private knowledge from accidental public exposure.

## Impact

- Browser shows a 503 response before the app loads.
- API calls return 503 in production.
- Users see a Basic Auth prompt and are unsure what credentials to use.

## Check

1. Confirm the health response:

   ```bash
   curl -i "$APP_URL/api/health"
   ```

2. Inspect deployment logs for middleware or auth configuration errors.
3. Confirm exactly one strong token variable is configured:
   - `COMPOUND_ADMIN_TOKEN` preferred.
   - `ADMIN_TOKEN` accepted as fallback.
4. Confirm the app was redeployed or restarted after changing environment
   variables.

## Recovery

1. Generate a strong random token if none exists:

   ```bash
   openssl rand -base64 32
   ```

2. Set it as `COMPOUND_ADMIN_TOKEN` in the deployment platform.
3. Redeploy or restart the service.
4. Test with either bearer or custom header auth:

   ```bash
   curl -i -H "Authorization: Bearer $COMPOUND_ADMIN_TOKEN" "$APP_URL/api/metrics"
   curl -i -H "X-Compound-Admin-Token: $COMPOUND_ADMIN_TOKEN" "$APP_URL/api/sync/dashboard"
   ```

5. For the browser Basic Auth prompt, the username can be any non-empty value;
   the password is the configured token.

## Verify

- The app loads after successful Basic Auth.
- `/api/health` returns JSON instead of a production-token error.
- Protected endpoints succeed when the token is provided and fail without it.

## Do not

- Do not remove auth in production to restore access faster.
- Do not paste the token into issue comments, PR descriptions, screenshots, or
  logs.
- Do not reuse an old token if you suspect it was exposed.
