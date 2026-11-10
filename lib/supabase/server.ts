import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { cookies } from 'next/headers';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import { supabaseAdmin } from './admin';

/**
 * Creates an auth-scoped Supabase client for Server Components, Server Actions,
 * and Route Handlers using Next.js request cookies.
 */
export async function createClient(): Promise<SupabaseClient> {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value;
        },
        set(name: string, value: string, options: CookieOptions) {
          try {
            cookieStore.set({ name, value, ...options });
          } catch {
            // Can happen in Server Components (read-only cookie store)
          }
        },
        remove(name: string, options: CookieOptions) {
          try {
            cookieStore.set({ name, value: '', ...options });
          } catch {
            // Can happen in Server Components
          }
        },
      },
    }
  );
}

/**
 * Authenticates the caller from either the Authorization header (Bearer token)
 * or the active session cookies. Returns the authenticated user and their profile row.
 */
export async function getAuthenticatedCaller(req?: Request): Promise<{
  user: User;
  profile: { id: string; role: string; is_active: boolean; full_name?: string };
} | null> {
  // 1. Try Authorization header first if request is provided
  if (req) {
    const authHeader = req.headers.get('authorization');
    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.replace(/^Bearer\s+/i, '').trim();
      const { data, error } = await supabaseAdmin.auth.getUser(token);
      if (!error && data?.user) {
        const { data: profile } = await supabaseAdmin
          .from('profiles')
          .select('id, role, is_active, full_name')
          .eq('id', data.user.id)
          .single();

        if (profile) {
          return { user: data.user, profile };
        }
      }
    }
  }

  // 2. Fall back to cookie-based session
  try {
    const supabase = await createClient();
    const { data: { user }, error } = await supabase.auth.getUser();

    if (error || !user) return null;

    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('id, role, is_active, full_name')
      .eq('id', user.id)
      .single();

    if (!profile) return null;

    return { user, profile };
  } catch {
    return null;
  }
}
