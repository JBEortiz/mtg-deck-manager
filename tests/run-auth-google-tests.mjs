import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";

function runTest(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      console.log(`PASS ${name}`);
    })
    .catch((error) => {
      console.error(`FAIL ${name}`);
      throw error;
    });
}

process.env.MTG_DB_PATH = path.join(os.tmpdir(), `mtg-auth-google-${Date.now()}.sqlite`);

const { createStoredUser, getUserByEmail, upsertGoogleUser } = await import("../lib/server/mtg-store.ts");
const { getGoogleOAuthConfig, buildGoogleConfigErrorDetail } = await import("../lib/server/google-oauth.ts");

await runTest("email/password users default to local provider and unverified email", async () => {
  const user = await createStoredUser({
    email: "local-auth@test.local",
    passwordHash: "hash"
  });

  assert.equal(user.authProvider, "local");
  assert.equal(user.emailVerified, false);
  assert.equal(user.googleSubject, null);
});

await runTest("google auth creates verified google-linked users", async () => {
  const user = await upsertGoogleUser({
    email: "google-auth@test.local",
    googleSubject: "google-sub-1",
    emailVerified: true
  });

  assert.equal(user.authProvider, "google");
  assert.equal(user.emailVerified, true);
  assert.equal(user.googleSubject, "google-sub-1");
});

await runTest("google auth links existing local users by email without breaking local provider", async () => {
  const local = await createStoredUser({
    email: "linked-auth@test.local",
    passwordHash: "hash"
  });
  assert.equal(local.authProvider, "local");
  assert.equal(local.googleSubject, null);

  const linked = await upsertGoogleUser({
    email: "linked-auth@test.local",
    googleSubject: "google-sub-linked",
    emailVerified: true
  });

  assert.equal(linked.id, local.id);
  assert.equal(linked.authProvider, "local");
  assert.equal(linked.googleSubject, "google-sub-linked");
  assert.equal(linked.emailVerified, true);

  const persisted = await getUserByEmail("linked-auth@test.local");
  assert.ok(persisted);
  assert.equal(persisted.id, local.id);
  assert.equal(persisted.googleSubject, "google-sub-linked");
});

await runTest("google config reports missing variables and supports origin-based callback fallback", async () => {
  process.env.GOOGLE_OAUTH_CLIENT_ID = "";
  process.env.GOOGLE_OAUTH_CLIENT_SECRET = "";
  process.env.GOOGLE_OAUTH_REDIRECT_URI = "";
  const missingConfig = getGoogleOAuthConfig({ requestUrl: "http://localhost:3000/api/auth/google/start" });
  assert.equal(missingConfig.enabled, false);
  assert.ok(missingConfig.missing.includes("GOOGLE_OAUTH_CLIENT_ID"));
  assert.ok(missingConfig.missing.includes("GOOGLE_OAUTH_CLIENT_SECRET"));
  assert.equal(buildGoogleConfigErrorDetail(missingConfig).includes("GOOGLE_OAUTH_CLIENT_ID"), true);

  process.env.GOOGLE_OAUTH_CLIENT_ID = "test-client";
  process.env.GOOGLE_OAUTH_CLIENT_SECRET = "test-secret";
  process.env.GOOGLE_OAUTH_REDIRECT_URI = "";
  const fallbackConfig = getGoogleOAuthConfig({ requestUrl: "http://localhost:3000/api/auth/google/start" });
  assert.equal(fallbackConfig.enabled, true);
  assert.equal(fallbackConfig.redirectUri, "http://localhost:3000/api/auth/google/callback");
});

await runTest("google config supports compatible env aliases and APP_BASE_URL fallback", async () => {
  process.env.GOOGLE_OAUTH_CLIENT_ID = "";
  process.env.GOOGLE_OAUTH_CLIENT_SECRET = "";
  process.env.GOOGLE_OAUTH_REDIRECT_URI = "";
  process.env.GOOGLE_CLIENT_ID = "alias-client";
  process.env.GOOGLE_CLIENT_SECRET = "alias-secret";
  process.env.APP_BASE_URL = "http://127.0.0.1:3000";

  const aliasedConfig = getGoogleOAuthConfig({});
  assert.equal(aliasedConfig.enabled, true);
  assert.equal(aliasedConfig.clientId, "alias-client");
  assert.equal(aliasedConfig.clientSecret, "alias-secret");
  assert.equal(aliasedConfig.redirectUri, "http://127.0.0.1:3000/api/auth/google/callback");

  process.env.GOOGLE_CLIENT_ID = "";
  process.env.GOOGLE_CLIENT_SECRET = "";
  process.env.APP_BASE_URL = "";
});

console.log("All auth google tests passed.");
