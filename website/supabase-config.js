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


// Transitional runtime configuration.
// When n8n is moved to the client environment, change ONLY n8nBaseUrl here.
// Operational Work Orders / Production / Patient Cases / reference data are already Supabase-native in V16.
window.FLOWRISE_RUNTIME = {
  environment: "production",
  n8nBaseUrl: "https://n8n.flowrisedental.ro/webhook",
  legacyModules: {
    ai: true,
    chatHistory: false,
    calendar: false,
    materials: false,
    adminUsers: false
  }
};
