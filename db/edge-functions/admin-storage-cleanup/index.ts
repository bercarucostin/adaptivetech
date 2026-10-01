import { createClient } from "npm:@supabase/supabase-js@2";
import { createAdminStorageCleanupHandler } from "./handler.mjs";
Deno.serve(createAdminStorageCleanupHandler({ createClient, getEnv: (name: string) => Deno.env.get(name) }));
