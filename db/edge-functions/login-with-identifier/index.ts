import { createClient } from "npm:@supabase/supabase-js@2";
import { createLoginHandler } from "./handler.mjs";

Deno.serve(createLoginHandler({ getEnv: (name: string) => Deno.env.get(name), createClient }));
