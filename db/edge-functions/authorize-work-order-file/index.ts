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

function safeFileName(name: string) {
  return String(name || "file")
    .normalize("NFKD")
    .replace(/[^\w.\-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 180);
}

function extension(name: string) {
  const p = String(name || "").toLowerCase().split(".");
  return p.length > 1 ? p.pop() || "" : "";
}

function norm(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

const allowedExtensions = new Set([
  "zip", "stl", "ply", "obj", "pdf", "jpg", "jpeg", "png",
]);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json({ message: "Method not allowed." }, 405);
  }

  try {
    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader.toLowerCase().startsWith("bearer ")) {
      return json({ message: "Authentication required." }, 401);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    if (!supabaseUrl || !anonKey || !serviceRoleKey) {
      return json({ message: "Storage authorization service is not configured." }, 500);
    }

    // Validate the caller with the real Supabase Auth JWT.
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: userData, error: userError } = await userClient.auth.getUser();
    const user = userData?.user;

    if (userError || !user?.id) {
      return json({ message: "Invalid session." }, 401);
    }

    // service_role remains server-side only.
    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: profile, error: profileError } = await admin
      .from("profiles")
      .select("id,username,legacy_user_id,technician_name,legacy_partner_name,display_name,active")
      .eq("id", user.id)
      .maybeSingle();

    if (profileError || !profile?.active) {
      return json({ message: "Active Flowrise profile not found." }, 403);
    }

    const body = await req.json();
    const action = String(body?.action || "").trim().toLowerCase();
    const workOrderId = Number(body?.work_order_id);

    if (!Number.isInteger(workOrderId) || workOrderId <= 0) {
      return json({ message: "Invalid work_order_id." }, 400);
    }

    if (!["upload", "download", "list", "delete"].includes(action)) {
      return json({ message: "Invalid action." }, 400);
    }

    // Resolve the Flowrise Lab once. No hard-coded UUID is needed in the frontend.
    const { data: lab, error: labError } = await admin
      .from("organizations")
      .select("id,name")
      .eq("slug", "flowrise-dental-lab")
      .eq("organization_type", "lab")
      .maybeSingle();

    if (labError || !lab?.id) {
      return json({ message: "Flowrise Dental Lab organization not found." }, 500);
    }

    // Work Orders are now checked directly in Supabase.
    const { data: order, error: orderError } = await admin
      .from("lab_work_orders")
      .select(`
        id,
        lab_organization_id,
        nume_partener,
        status,
        locked,
        tehnician_model,
        tehnician1_modelare,
        tehnician2_cer_fin
      `)
      .eq("lab_organization_id", lab.id)
      .eq("id", workOrderId)
      .maybeSingle();

    if (orderError || !order) {
      return json({ message: `Work order #${workOrderId} not found.` }, 404);
    }

    // First try direct Lab membership.
    const { data: labMembership } = await admin
      .from("organization_memberships")
      .select("organization_id,role,status")
      .eq("organization_id", lab.id)
      .eq("user_id", user.id)
      .eq("status", "active")
      .maybeSingle();

    let role = String(labMembership?.role || "").trim().toLowerCase();
    let clinicOrgId: string | null = null;

    // A Doctor belongs to a Clinic, not to the Lab.
    if (!role) {
      const { data: clinicMemberships, error: clinicMembershipError } = await admin
        .from("organization_memberships")
        .select(`
          organization_id,
          role,
          status,
          organizations!inner (
            id,
            organization_type
          )
        `)
        .eq("user_id", user.id)
        .eq("status", "active")
        .eq("role", "Doctor");

      if (clinicMembershipError) {
        return json({ message: "Could not resolve Clinic membership." }, 500);
      }

      const clinicMembership = (clinicMemberships || []).find(
        (m: any) => m?.organizations?.organization_type === "clinic"
      );

      if (clinicMembership?.organization_id) {
        const { data: relationship } = await admin
          .from("organization_relationships")
          .select("id,status")
          .eq("clinic_organization_id", clinicMembership.organization_id)
          .eq("lab_organization_id", lab.id)
          .eq("status", "active")
          .maybeSingle();

        if (relationship?.id) {
          role = "doctor";
          clinicOrgId = clinicMembership.organization_id;
        }
      }
    }

    if (!role) {
      return json({ message: "No active organization access for this laboratory." }, 403);
    }

    const orderLocked = Boolean(order.locked);
    const orderStatus = norm(order.status);
    const partnerKey = norm(order.nume_partener);
    const doctorPartnerKeys = [
      profile.legacy_partner_name,
      profile.display_name,
      profile.legacy_user_id,
    ].map(norm).filter(Boolean);

    const technicianKey = norm(profile.technician_name);
    const assignedToTechnician =
      technicianKey !== "" &&
      [
        order.tehnician_model,
        order.tehnician1_modelare,
        order.tehnician2_cer_fin,
      ].some((v) => norm(v) === technicianKey);

    let allowed = false;
    let message = "File operation is not allowed for this role.";

    if (role === "admin" || role === "manager") {
      allowed = true;
      message = "Allowed";
    } else if (role === "doctor") {
      const ownsOrder =
        partnerKey !== "" &&
        doctorPartnerKeys.some((key) => key === partnerKey);

      if (!ownsOrder) {
        return json({
          message: "Doctor can access files only for work orders assigned to the Doctor or clinic.",
        }, 403);
      }

      // V18.6: attachments remain additive even after the case enters
      // production or is locked. The Doctor must still own the Clinic case.
      if (action === "list" || action === "download" || action === "upload") {
        allowed = true;
        message = "Allowed";
      } else {
        // Delete keeps the stricter historical rule.
        if (orderLocked) {
          return json({ message: "Work order is locked. Doctor file deletion is disabled." }, 403);
        }

        if (orderStatus !== "notstarted") {
          return json({
            message: "Doctor file deletion is allowed only while Status = Not Started.",
          }, 403);
        }

        allowed = true;
        message = "Allowed";
      }
    } else if (role === "technician") {
      if (!assignedToTechnician) {
        return json({
          message: "Technician can access files only for assigned work orders.",
        }, 403);
      }

      // V18.6: assigned Technicians may add and download case attachments.
      // Delete remains unavailable to Technicians.
      if (action === "list" || action === "download" || action === "upload") {
        allowed = true;
        message = "Allowed";
      } else {
        return json({
          message: "Technicians cannot delete work-order files.",
        }, 403);
      }
    } else if (role === "dashboard") {
      return json({
        message: "Dashboard role does not have access to work-order files.",
      }, 403);
    }

    if (!allowed) {
      return json({ message }, 403);
    }

    // ----------------------------------------------------------
    // LIST
    // ----------------------------------------------------------
    if (action === "list") {
      const { data, error } = await admin
        .from("work_order_files")
        .select(`
          id,
          legacy_work_order_id,
          object_path,
          original_file_name,
          file_size_bytes,
          mime_type,
          file_extension,
          file_kind,
          created_at,
          uploaded_by_user_id
        `)
        .eq("legacy_work_order_id", workOrderId)
        .order("created_at", { ascending: false });

      if (error) throw error;
      return json({ ok: true, files: data || [] });
    }

    // ----------------------------------------------------------
    // DOWNLOAD
    // ----------------------------------------------------------
    if (action === "download") {
      const fileId = String(body?.file_id || "").trim();
      if (!fileId) return json({ message: "file_id is required." }, 400);

      const { data: fileRow, error: fileError } = await admin
        .from("work_order_files")
        .select("*")
        .eq("id", fileId)
        .eq("legacy_work_order_id", workOrderId)
        .maybeSingle();

      if (fileError || !fileRow) {
        return json({ message: "File not found." }, 404);
      }

      const { data: signed, error: signedError } = await admin.storage
        .from(fileRow.bucket_name || "work-order-files")
        .createSignedUrl(fileRow.object_path, 600, {
          download: fileRow.original_file_name,
        });

      if (signedError || !signed?.signedUrl) {
        throw signedError || new Error("Could not create download URL.");
      }

      return json({
        ok: true,
        signed_url: signed.signedUrl,
        expires_in: 600,
        file: {
          id: fileRow.id,
          name: fileRow.original_file_name,
          size: fileRow.file_size_bytes,
        },
      });
    }

    // ----------------------------------------------------------
    // DELETE
    // ----------------------------------------------------------
    if (action === "delete") {
      const fileId = String(body?.file_id || "").trim();
      if (!fileId) return json({ message: "file_id is required." }, 400);

      const { data: fileRow, error: fileError } = await admin
        .from("work_order_files")
        .select("*")
        .eq("id", fileId)
        .eq("legacy_work_order_id", workOrderId)
        .maybeSingle();

      if (fileError || !fileRow) {
        return json({ message: "File not found." }, 404);
      }

      const { error: storageError } = await admin.storage
        .from(fileRow.bucket_name || "work-order-files")
        .remove([fileRow.object_path]);

      if (storageError) throw storageError;

      const { error: deleteError } = await admin
        .from("work_order_files")
        .delete()
        .eq("id", fileId);

      if (deleteError) throw deleteError;

      return json({ ok: true });
    }

    // ----------------------------------------------------------
    // UPLOAD
    // ----------------------------------------------------------
    const fileName = safeFileName(String(body?.file_name || ""));
    const fileSize = Number(body?.file_size || 0);
    const mimeType = String(body?.mime_type || "application/octet-stream");
    const fileKind = String(body?.file_kind || "").trim() || null;
    const ext = extension(fileName);
    const maxBytes = 45 * 1024 * 1024;

    if (!fileName || !allowedExtensions.has(ext)) {
      return json({ message: "File type is not allowed." }, 400);
    }

    if (!Number.isFinite(fileSize) || fileSize <= 0 || fileSize > maxBytes) {
      return json({ message: "File exceeds the current 45 MB upload limit." }, 400);
    }

    const objectId = crypto.randomUUID();
    const objectPath = `work-orders/${workOrderId}/${objectId}_${fileName}`;
    const bucket = "work-order-files";

    const { data: signedUpload, error: uploadUrlError } = await admin.storage
      .from(bucket)
      .createSignedUploadUrl(objectPath, { upsert: false });

    if (uploadUrlError || !signedUpload?.token) {
      throw uploadUrlError || new Error("Could not create signed upload URL.");
    }

    const { data: metadata, error: metadataError } = await admin
      .from("work_order_files")
      .insert({
        legacy_work_order_id: workOrderId,
        clinic_organization_id: clinicOrgId,
        lab_organization_id: lab.id,
        bucket_name: bucket,
        object_path: objectPath,
        original_file_name: fileName,
        file_size_bytes: fileSize,
        mime_type: mimeType,
        file_extension: ext,
        file_kind: fileKind,
        shared_with_lab: true,
        uploaded_by_user_id: user.id,
      })
      .select("id,object_path,original_file_name,file_size_bytes")
      .single();

    if (metadataError) throw metadataError;

    return json({
      ok: true,
      upload: {
        bucket,
        path: objectPath,
        token: signedUpload.token,
      },
      file: metadata,
    });
  } catch (error) {
    console.error("authorize-work-order-file:", error);
    return json({ message: "Could not authorize file operation." }, 500);
  }
});
