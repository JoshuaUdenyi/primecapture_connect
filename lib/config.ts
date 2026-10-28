export function isDemo() {
  return process.env.NODE_ENV !== 'production' && process.env.DEMO_MODE === 'true';
}
export function assertRuntimeSafety() {
  if (process.env.NODE_ENV === 'production' && (process.env.DEMO_MODE === 'true' || process.env.MOCK_META_ENABLED === 'true')) {
    throw new Error('Development simulation is forbidden in production');
  }
}
export function missingAuthSettings() {
  return (['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY'] as const)
    .filter(name => !process.env[name]?.trim());
}
export function authConfigured() {
  return missingAuthSettings().length === 0;
}
// These gates deliberately stay closed until evidence is reviewed and an implementation ships.
export const capabilities = { pagePublishing: false, businessRequests: false, profilePublishing: false, remoteObsControl: false } as const;
