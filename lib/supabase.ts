/**
 * @deprecated — This file is kept only for backward compatibility.
 * Use lib/auth.ts and utils/authUtils.ts instead.
 *
 * The Supabase client has been replaced by Better Auth.
 * Any imports from this file should be migrated to the new auth system.
 */

// Re-export from the new auth module so existing imports don't break at compile time
export { authClient as supabase } from "./auth";

console.warn(
  "[DEPRECATED] lib/supabase.ts is deprecated. " +
  "Migrate imports to lib/auth.ts or utils/authUtils.ts"
);
