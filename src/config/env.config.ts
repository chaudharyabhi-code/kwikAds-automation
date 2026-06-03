
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

export const envConfig = {
  isCI: process.env.CI === 'true',

  // KwikAds
  apiBaseUrl: process.env.API_BASE_URL || 'https://gkx.gokwik.co',
  kwikadsUsername: process.env.KWIKADS_USERNAME || '',
  kwikadsPassword: process.env.KWIKADS_PASSWORD || '',

  // Meta
  metaEmail: process.env.META_EMAIL || '',
  metaPassword: process.env.META_PASSWORD || '',

  // Shopify Partner dev dashboard — credentials are typed manually in the
  // browser by the human running `npm run shopify:login`. Session is captured
  // via persistent profile (shopify-partner-profile/) plus a storage-state
  // snapshot (shopify-partner.state.json) for future programmatic reuse.
  // GK Admin needs no separate auth: it's reached during tests by navigating
  // a specific merchant store and triggering the Kwikpass install flow, which
  // SSOs into GK Admin transparently using the Shopify session.

  // Google SSO auto-click — set to the email shown in Chrome's account chooser.
  // If empty, auto-click is disabled and manual SSO is required as usual.
  gokwikSsoEmail: process.env.GOKWIK_SSO_EMAIL || '',

  // Kwik AI Assistant
  kwikAiBaseUrl:      process.env.KWIK_AI_BASE_URL       || '',
  kwikAiDashboardUrl: process.env.KWIK_AI_DASHBOARD_URL  || '',
  // Optional: pre-set a Bearer token (from network tab).
  // If empty, KwikAiValidationService will auto-login using kwikadsUsername/Password.
  kwikAiAuthToken:    process.env.KWIK_AI_AUTH_TOKEN     || '',
  // Login endpoint for auto-login — set KWIK_AI_LOGIN_URL if the default is wrong.
  // Find the correct URL: open browser → log in → Network tab → find the login POST.
  kwikAiLoginUrl:     process.env.KWIK_AI_LOGIN_URL      || '',
};