# Publishing to npm

## Prerequisites
- npm account with 2FA enabled (TOTP authenticator app required)
- Logged in: `npm whoami`

## Publish

```bash
# 1. Bump version (pick one)
npm version patch   # 0.1.1 → 0.1.2
npm version minor   # 0.1.2 → 0.2.0
npm version major   # 0.2.0 → 1.0.0

# 2. Type-check
npx tsc --noEmit

# 3. Publish (grab OTP from authenticator app)
npm publish --access public --otp=YOUR_6_DIGIT_CODE

# 4. Push version commit + tag to GitHub
git push && git push --tags
```

## Verify

```bash
npm view opencode-auto-loop
```
