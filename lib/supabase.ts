import { createClient } from '@supabase/supabase-js'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
const key = process.env.SUPABASE_SERVICE_ROLE_KEY!

// Server-only client — never expose service role key to the browser
export const supabase = createClient(url, key, {
  auth: { persistSession: false },
})
