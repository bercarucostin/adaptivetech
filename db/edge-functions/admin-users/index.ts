import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}

function clean(value: unknown) {
  return String(value ?? "").trim();
}

function usernameBase(value: unknown) {
  return clean(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40) || "user";
}

function validUsername(value: string) {
  return /^[a-z0-9_]{3,40}$/.test(value);
}

function isLabPartnerRole(value: unknown) {
  return ["lab partner", "lab_partner"].includes(clean(value).toLowerCase());
}

// Server-only: the callback is deployment configuration, never request input.
async function createAuthAccount(
  authAdmin: ReturnType<typeof createClient>["auth"]["admin"],
  { email, name, password, invite }: { email: string; name: string; password: string; invite: boolean },
  redirect: string
) {
  if(invite){
    let url;
    try{url=new URL(redirect);}catch{throw new Error('Configure APP_PASSWORD_REDIRECT_URL before sending invitations.');}
    if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||!url.pathname.endsWith('/password.html')){
      throw new Error('APP_PASSWORD_REDIRECT_URL must be an HTTPS password.html URL without query parameters.');
    }
    url.searchParams.set('mode','invite');
    return authAdmin.inviteUserByEmail(email,{redirectTo:url.href,data:{display_name:name}});
  }
  return authAdmin.createUser({email,password,email_confirm:true,user_metadata:{display_name:name}});
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ message: "Method not allowed." }, 405);

  let createdAuthUserId: string | null = null;

  try {
    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader.toLowerCase().startsWith("bearer ")) {
      return json({ message: "Authentication required." }, 401);
    }

    const url = Deno.env.get("SUPABASE_URL")!;
    const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(url, anon, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: userData, error: userError } = await userClient.auth.getUser();
    const caller = userData?.user;
    if (userError || !caller?.id) return json({ message: "Invalid session." }, 401);

    const admin = createClient(url, service, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: lab } = await admin
      .from("organizations")
      .select("id")
      .eq("slug", "flowrise-dental-lab")
      .maybeSingle();

    const { data: clinic } = await admin
      .from("organizations")
      .select("id")
      .eq("slug", "beautydent")
      .maybeSingle();

    if (!lab?.id || !clinic?.id) {
      return json({ message: "Flowrise organizations are not configured." }, 500);
    }

    const { data: callerMembership } = await admin
      .from("organization_memberships")
      .select("role,status")
      .eq("organization_id", lab.id)
      .eq("user_id", caller.id)
      .eq("status", "active")
      .maybeSingle();

    if (String(callerMembership?.role || "").toLowerCase() !== "admin") {
      return json({ message: "Admin access required." }, 403);
    }

    const body = await req.json();
    const action = clean(body?.action).toLowerCase();
    const data = body?.data || {};
    for (const key of ["Notify_New_Work_Order", "Notify_Stage_Status"]) {
      if (key in data && typeof data[key] !== "boolean") return json({ message: "Notification preferences must be boolean." }, 400);
    }
    const notificationPatch = {
      ...("Notify_New_Work_Order" in data ? { notify_new_work_order: data.Notify_New_Work_Order } : {}),
      ...("Notify_Stage_Status" in data ? { notify_stage_status: data.Notify_Stage_Status } : {}),
    };

    async function validatedPartnerId(role: string, rawId: unknown): Promise<string | null> {
      if (!isLabPartnerRole(role)) return null;
      const partnerId = clean(rawId);
      if (!partnerId) throw new Error("Select an active partner for the Lab Partner user.");
      const { data: partner, error } = await admin.from("lab_partners")
        .select("id")
        .eq("id", partnerId)
        .eq("lab_organization_id", lab.id)
        .eq("active", true)
        .maybeSingle();
      if (error) throw error;
      if (!partner) throw new Error("The selected partner is unavailable.");
      return partner.id;
    }

    async function savePartnerLink(userId: string, partnerId: string | null) {
      if (partnerId) {
        const { error } = await admin.from("lab_partner_user_links").upsert({
          lab_organization_id: lab.id, user_id: userId, partner_id: partnerId,
          updated_at: new Date().toISOString(),
        }, { onConflict: "lab_organization_id,user_id" });
        if (error) throw error;
      } else {
        const { error } = await admin.from("lab_partner_user_links").delete()
          .eq("lab_organization_id", lab.id).eq("user_id", userId);
        if (error) throw error;
      }
    }

    if (action === "list") {
      const { data: profiles, error: profilesError } = await admin
        .from("profiles")
        .select("id,username,display_name,legacy_user_id,technician_name,legacy_partner_name,active,notify_new_work_order,notify_stage_status")
        .order("display_name");

      if (profilesError) throw profilesError;

      const ids = (profiles || []).map((p: any) => p.id);

      const { data: memberships, error: membershipsError } = await admin
        .from("organization_memberships")
        .select("user_id,organization_id,role,status")
        .in("user_id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]);

      if (membershipsError) throw membershipsError;

      const { data: partnerLinks, error: linksError } = await admin
        .from("lab_partner_user_links").select("user_id,partner_id")
        .eq("lab_organization_id", lab.id);
      if (linksError) throw linksError;
      const partnerIdByUser = new Map((partnerLinks || []).map((link: any) => [link.user_id, link.partner_id]));

      const authUsers: any[] = [];
      let page = 1;
      while (page <= 10) {
        const { data: authPage, error: authError } = await admin.auth.admin.listUsers({
          page,
          perPage: 100,
        });
        if (authError) throw authError;
        authUsers.push(...(authPage?.users || []));
        if (!authPage?.users?.length || authPage.users.length < 100) break;
        page++;
      }

      const emailById = new Map(authUsers.map((u: any) => [u.id, u.email || ""]));

      const users = (profiles || []).map((p: any) => {
        const ms = (memberships || []).filter((m: any) => m.user_id === p.id);
        const doctor = ms.find((m: any) =>
          m.organization_id === clinic.id && String(m.role).toLowerCase() === "doctor"
        );
        const labM = ms.find((m: any) => m.organization_id === lab.id);
        const selected = doctor || labM || ms[0] || null;

        return {
          User_ID: p.legacy_user_id || p.username,
          Username: p.username || "",
          Email: emailById.get(p.id) || "",
          Name: p.display_name || p.username,
          Role: selected?.role || "",
          Technician_Name: p.technician_name || "",
          Partner_Name: p.legacy_partner_name || "",
          Partner_ID: partnerIdByUser.get(p.id) || "",
          Active: Boolean(p.active) && String(selected?.status || "") === "active",
          Supabase_User_ID: p.id,
          Notify_New_Work_Order: Boolean(p.notify_new_work_order),
          Notify_Stage_Status: Boolean(p.notify_stage_status),
        };
      });

      const { data: roleRows } = await admin
        .from("role_permissions")
        .select("role")
        .eq("active", true)
        .order("role");

      return json({
        ok: true,
        users,
        roles: (roleRows || []).map((r: any) => r.role),
      });
    }

    const legacyUserId = clean(data.User_ID);
    if (!legacyUserId) return json({ message: "Internal User ID is required." }, 400);

    // Resolve inactive profiles too. Reactivation and deletion must still be
    // possible after `profiles.active` has been set to false.
    const targetSupabaseUserId = clean(data.Supabase_User_ID);
    const { data: profiles, error: profileSearchError } = await admin
      .from("profiles")
      .select("id,username,legacy_user_id,active");

    if (profileSearchError) throw profileSearchError;

    const normalizedUserId = legacyUserId.toLowerCase();
    const identifierMatches = (profiles || []).filter(
      (p: any) =>
        String(p.legacy_user_id || "").trim().toLowerCase() === normalizedUserId ||
        String(p.username || "").trim().toLowerCase() === normalizedUserId
    );
    const uuidProfile = targetSupabaseUserId
      ? (profiles || []).find((p: any) => p.id === targetSupabaseUserId) || null
      : null;

    if (targetSupabaseUserId && !uuidProfile) {
      return json({ message: "User not found." }, 404);
    }
    if (uuidProfile && identifierMatches.some((p: any) => p.id !== uuidProfile.id)) {
      return json({ message: "User identifiers refer to different accounts." }, 409);
    }
    if (!uuidProfile && identifierMatches.length > 1) {
      return json({ message: "Internal User ID is ambiguous." }, 409);
    }

    const existingProfile = uuidProfile ||
      (identifierMatches.length === 1 ? identifierMatches[0] : null);

    if (action === "create") {
      if (existingProfile?.id) return json({ message: "Internal User ID already exists." }, 409);

      const email = clean(data.Email).toLowerCase();
      const password = String(data.Password ?? "");
      const invite = data.Send_Invite === true;
      if ("Send_Invite" in data && typeof data.Send_Invite !== "boolean") return json({ message: "Send_Invite must be boolean." }, 400);
      const name = clean(data.Name);
      const role = clean(data.Role);
      const partnerId = await validatedPartnerId(role, data.Partner_ID);
      const active = data.Active !== false;
      const username = clean(data.Username || usernameBase(legacyUserId)).toLowerCase();

      if (!email || (!invite && !password) || !name || !role || !username) {
        return json({ message: "Username, Email, Name, Role and either invitation or password are required." }, 400);
      }
      if (!validUsername(username)) {
        return json({ message: "Username must be 3–40 characters using only lowercase letters, numbers and _." }, 400);
      }

      const { data: usernameConflict, error: usernameConflictError } = await admin
        .from("profiles")
        .select("id")
        .eq("username", username)
        .maybeSingle();

      if (usernameConflictError) throw usernameConflictError;
      if (usernameConflict?.id) return json({ message: "Username already exists." }, 409);

      if (invite && !active) return json({ message: "Activează contul înainte de a trimite invitația." }, 400);
      const { data: created, error: createError } = await createAuthAccount(
        admin.auth.admin, { email, password, name, invite },
        Deno.env.get("APP_PASSWORD_REDIRECT_URL") || ""
      );
      if (createError || !created?.user?.id) {
        throw createError || new Error("Account creation failed.");
      }

      createdAuthUserId = created.user.id;

      const { error: profileError } = await admin.from("profiles").upsert({
        id: created.user.id,
        username,
        display_name: name,
        legacy_user_id: legacyUserId,
        active,
        ...notificationPatch,
        technician_name: clean(data.Technician_Name) || null,
        legacy_partner_name: clean(data.Partner_Name) || null,
        updated_at: new Date().toISOString(),
      });
      if (profileError) throw profileError;

      const targetOrg = role.toLowerCase() === "doctor" ? clinic.id : lab.id;

      const { error: membershipError } = await admin.from("organization_memberships").upsert({
        organization_id: targetOrg,
        user_id: created.user.id,
        role,
        status: active ? "active" : "suspended",
      }, { onConflict: "organization_id,user_id" });

      if (membershipError) throw membershipError;

      await savePartnerLink(created.user.id, partnerId);

      await admin.from("legacy_user_directory").upsert({
        legacy_user_id: legacyUserId,
        name,
        role,
        technician_name: clean(data.Technician_Name) || null,
        active,
        partner_name: clean(data.Partner_Name) || null,
        migrated_at: new Date().toISOString(),
      });

      createdAuthUserId = null;
      return json({ ok: true, user_id: created.user.id, username, invited: invite });
    }

    if (!existingProfile?.id) return json({ message: "User not found." }, 404);

    if (action === "update") {
      const role = clean(data.Role);
      const partnerId = await validatedPartnerId(role, data.Partner_ID);
      const name = clean(data.Name);
      const active = data.Active !== false;
      const username = clean(data.Username || existingProfile.username).toLowerCase();

      if (!role || !name || !username) {
        return json({ message: "Username, Name and Role are required." }, 400);
      }
      if (!validUsername(username)) {
        return json({ message: "Username must be 3–40 characters using only lowercase letters, numbers and _." }, 400);
      }

      if (existingProfile.id === caller.id && (role.toLowerCase() !== "admin" || !active)) {
        return json({ message: "You cannot remove your own active Admin access." }, 400);
      }

      const { data: usernameConflict, error: usernameConflictError } = await admin
        .from("profiles")
        .select("id")
        .eq("username", username)
        .maybeSingle();

      if (usernameConflictError) throw usernameConflictError;
      if (usernameConflict?.id && usernameConflict.id !== existingProfile.id) {
        return json({ message: "Username already exists." }, 409);
      }

      const authPatch: any = {};
      if (clean(data.Email)) authPatch.email = clean(data.Email).toLowerCase();
      if (String(data.Password ?? "")) authPatch.password = String(data.Password);
      if (name) authPatch.user_metadata = { display_name: name };

      if (Object.keys(authPatch).length) {
        const { error: authUpdateError } = await admin.auth.admin.updateUserById(
          existingProfile.id,
          authPatch
        );
        if (authUpdateError) throw authUpdateError;
      }

      const { error: profileUpdateError } = await admin
        .from("profiles")
        .update({
          username,
          display_name: name,
          active,
          ...notificationPatch,
          technician_name: clean(data.Technician_Name) || null,
          legacy_partner_name: clean(data.Partner_Name) || null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", existingProfile.id);

      if (profileUpdateError) throw profileUpdateError;

      await admin
        .from("organization_memberships")
        .delete()
        .eq("user_id", existingProfile.id)
        .in("organization_id", [lab.id, clinic.id]);

      const targetOrg = role.toLowerCase() === "doctor" ? clinic.id : lab.id;
      const { error: membershipError } = await admin.from("organization_memberships").insert({
        organization_id: targetOrg,
        user_id: existingProfile.id,
        role,
        status: active ? "active" : "suspended",
      });
      if (membershipError) throw membershipError;

      await savePartnerLink(existingProfile.id, partnerId);

      await admin.from("legacy_user_directory").upsert({
        legacy_user_id: legacyUserId,
        name,
        role,
        technician_name: clean(data.Technician_Name) || null,
        active,
        partner_name: clean(data.Partner_Name) || null,
        migrated_at: new Date().toISOString(),
      });

      return json({ ok: true, username });
    }

    if (action === "delete") {
      if (existingProfile.id === caller.id) {
        return json({ message: "You cannot delete your own account." }, 400);
      }

      // Deleting the Auth user cascades to profiles and memberships through
      // their foreign keys, avoiding a partially deleted account.
      const { error: deleteAuthError } = await admin.auth.admin.deleteUser(existingProfile.id);
      if (deleteAuthError) throw deleteAuthError;

      const { error: legacyDeleteError } = await admin
        .from("legacy_user_directory")
        .delete()
        .eq("legacy_user_id", legacyUserId);
      if (legacyDeleteError) throw legacyDeleteError;

      return json({ ok: true });
    }

    return json({ message: "Unsupported action." }, 400);
  } catch (error) {
    if (createdAuthUserId) {
      try {
        const url = Deno.env.get("SUPABASE_URL")!;
        const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
        const cleanup = createClient(url, service, {
          auth: { persistSession: false, autoRefreshToken: false },
        });
        await cleanup.auth.admin.deleteUser(createdAuthUserId);
      } catch {}
    }

    console.error("admin-users:", error);
    return json({ message: error?.message || "User operation failed." }, 500);
  }
});
