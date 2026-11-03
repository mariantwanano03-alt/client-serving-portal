import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// Service-role client for admin API routes. This key must only ever exist
// server-side (never prefix it with NEXT_PUBLIC_).
export const supabaseAdmin: SupabaseClient = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

type CallerProfile = {
  id: string;
  role: string;
  is_active: boolean;
};

// Verify the caller's Bearer token belongs to an authenticated user and
// return their profile row, so admin-only API routes can authorize the
// request server-side.
export async function getCallerProfile(authHeader: string | null): Promise<CallerProfile | null> {
  const { data, error } = await supabaseAdmin.auth.getUser(
    authHeader?.replace(/^Bearer\s+/i, '') ?? undefined
  );

  if (error || !data?.user) return null;

  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('id, role, is_active')
    .eq('id', data.user.id)
    .single();

  return profile ?? null;
}
