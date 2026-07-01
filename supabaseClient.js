import { createClient } from "@supabase/supabase-js"

const runtimeUrl = typeof window !== "undefined" ? window.SUPABASE_URL : ""
const runtimeAnon = typeof window !== "undefined" ? window.SUPABASE_ANON_KEY : ""

const envUrl = import.meta.env?.VITE_SUPABASE_URL || ""
const envAnon = import.meta.env?.VITE_SUPABASE_ANON_KEY || ""

export const SUPABASE_URL = runtimeUrl || envUrl
export const SUPABASE_ANON_KEY = runtimeAnon || envAnon
export const supabaseConfigured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY)

export const supabase = supabaseConfigured
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : null
