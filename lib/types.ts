export type Role = 'admin' | 'operator';
export type Staff = { user_id: string; email: string; role: Role; is_active: boolean };
export type Client = { id: string; name: string; notes: string; created_at: string };
export type Destination = { id: string; client_id: string; external_id: string; display_name: string; provider: 'facebook'; kind: 'page'; connection_status: 'requested' | 'business_approved' | 'oauth_authorized' | 'publish_ready' | 'expired' | 'revoked'; publish_capable: boolean; last_verified_at: string | null; created_at: string };
export type Production = { id: string; client_id: string; destination_id: string | null; title: string; status: 'DRAFT' | 'ACCESS_PENDING'; created_by: string; created_at: string };
export type Agent = { id: string; name: string; paired_by: string; last_seen_at: string | null; revoked_at: string | null; obs_connected: boolean; output_active: boolean; recording_active: boolean; created_at: string };
export type Audit = { id: string; actor_user_id: string; action: string; resource_id: string | null; created_at: string };
export type DashboardData = { staff: Staff; demo: boolean; clients: Client[]; destinations: Destination[]; productions: Production[]; agents: Agent[]; audit: Audit[] };
