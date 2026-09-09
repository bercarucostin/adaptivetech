// Flowrise Supabase configuration.
// Browser-safe values only.
// NEVER put service_role, database password, JWT secret or other server secrets here.
window.FLOWRISE_SUPABASE = {
  enabled: true,
  projectUrl: "https://qlynvfltjgjgeipndior.supabase.co",
  publishableKey: "sb_publishable_mjDZLRQbubpv2ZISx-bm0w_Ne0z0aY0",
  storageBucket: "work-order-files",

  // Public unauthenticated Edge Function used only to resolve nickname -> Supabase identity.
  // Deploy with JWT verification disabled. Password verification is still performed by Supabase Auth.
  loginFunction: "login-with-identifier",
  adminUsersFunction: "admin-users",

  // Current Free-plan UI cap.
  currentUploadLimitMB: 45,

  // Future target after moving to a paid plan.
  futureUploadLimitMB: 200
};


// Runtime configuration.
//
// n8nBaseUrl is same-origin now. Caddy on app.flowrisedental.ro maps
// /api/ai/* onto n8n's /webhook/*, so the browser never talks to the n8n
// hostname directly. That removes the CORS surface entirely and puts one
// front door in front of a paid API, which is where rate limiting belongs.
// The n8n editor stays at n8n.flowrisedental.ro and no longer serves
// production webhooks.
// Operational Work Orders / Production / Patient Cases / reference data are already Supabase-native in V16.
window.FLOWRISE_RUNTIME = {
  environment: "production",
  n8nBaseUrl: "/api/ai",
  legacyModules: {
    ai: true,
    chatHistory: false,
    calendar: false,
    materials: false,
    adminUsers: false
  }
};
