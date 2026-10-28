import { ApiError } from '@/lib/security/errors';
export type PageVerification = { externalId: string; status: 'oauth_authorized' | 'revoked'; publishCapable: false; simulated: boolean };
export interface MetaProvider { verifyPage(id: string): Promise<PageVerification>; }
export class MockMetaProvider implements MetaProvider {
  constructor() {
    if (process.env.NODE_ENV === 'production' || process.env.MOCK_META_ENABLED !== 'true') throw new Error('Mock Meta is restricted to explicitly enabled development');
  }
  async verifyPage(id: string): Promise<PageVerification> {
    return { externalId: id, status: 'oauth_authorized', publishCapable: false, simulated: true };
  }
}
export class GraphMetaProvider implements MetaProvider {
  async verifyPage(): Promise<PageVerification> {
    throw new ApiError(409, 'META_UNVERIFIED', 'Meta permissions and Page verification require a reviewed integration. Follow the feasibility checklist.');
  }
}
