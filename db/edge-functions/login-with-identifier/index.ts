import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: corsHeaders,
  });
}

function genericAuthError() {
  return json({ message: "Nickname/email sau parolă incorectă." }, 401);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json({ message: "Method not allowed." }, 405);
  }

  try {
    const { identifier, password } = await req.json();

    const cleanIdentifier = String(identifier ?? "").trim().toLowerCase();
    const cleanPassword = String(password ?? "");

    if (!cleanIdentifier || !cleanPassword) {
      return genericAuthError();
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !anonKey || !serviceRoleKey) {
      console.error("Missing Supabase function environment variables.");
      return json({ message: "Auth service is not configured." }, 500);
    }

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const authClient = createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    let email = cleanIdentifier.includes("@") ? cleanIdentifier : "";
    let profile:
      | {
          id: string;
          username: string | null;
          display_name: string | null;
          legacy_user_id: string | null;
          active: boolean;
        }
      | null = null;

    // Nickname login: resolve only on the server.
    if (!email) {
      const { data, error } = await admin
        .from("profiles")
        .select("id,username,display_name,legacy_user_id,active")
        .eq("username", cleanIdentifier)
        .maybeSingle();

      if (error) {
        console.error("Profile lookup failed:", error.message);
        return genericAuthError();
      }

      if (!data?.id || !data.active) {
        return genericAuthError();
      }

      profile = data;

      const { data: authUserData, error: authUserError } =
        await admin.auth.admin.getUserById(data.id);

      if (authUserError || !authUserData?.user?.email) {
        console.error("Auth user lookup failed:", authUserError?.message);
        return genericAuthError();
      }

      email = authUserData.user.email.toLowerCase();
    }

    // Email/password verification is always delegated to Supabase Auth.
    const { data: signIn, error: signInError } =
      await authClient.auth.signInWithPassword({
        email,
        password: cleanPassword,
      });

    if (signInError || !signIn?.session || !signIn?.user) {
      return genericAuthError();
    }

    // Email login also needs the application profile.
    if (!profile) {
      const { data, error } = await admin
        .from("profiles")
        .select("id,username,display_name,legacy_user_id,active")
        .eq("id", signIn.user.id)
        .maybeSingle();

      if (error || !data?.id || !data.active) {
        console.error("Profile after email login failed:", error?.message);
        return genericAuthError();
      }

      profile = data;
    }

    return json({
      ok: true,
      session: {
        access_token: signIn.session.access_token,
        refresh_token: signIn.session.refresh_token,
        expires_at: signIn.session.expires_at,
        expires_in: signIn.session.expires_in,
        token_type: signIn.session.token_type,
      },
      profile: {
        id: profile.id,
        username: profile.username,
        display_name: profile.display_name,
        legacy_user_id: profile.legacy_user_id,
        email: signIn.user.email,
      },
    });
  } catch (error) {
    console.error("login-with-identifier unexpected error:", error);
    return genericAuthError();
  }
});