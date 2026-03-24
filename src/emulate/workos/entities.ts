import type { Entity } from '../core/index.js';

export interface WorkOSOrganization extends Entity {
  object: 'organization';
  name: string;
  external_id: string | null;
  metadata: Record<string, string>;
  stripe_customer_id: string | null;
}

export interface WorkOSOrganizationDomain extends Entity {
  object: 'organization_domain';
  organization_id: string;
  domain: string;
  state: 'verified' | 'pending';
  verification_strategy: 'manual' | 'dns';
  verification_token: string;
  verification_prefix: string;
}

export interface WorkOSOrganizationMembership extends Entity {
  object: 'organization_membership';
  organization_id: string;
  user_id: string;
  role: { slug: string };
  status: 'active' | 'inactive' | 'pending';
  external_id: string | null;
  metadata: Record<string, string>;
}

export interface WorkOSUser extends Entity {
  object: 'user';
  email: string;
  first_name: string | null;
  last_name: string | null;
  email_verified: boolean;
  profile_picture_url: string | null;
  last_sign_in_at: string | null;
  external_id: string | null;
  metadata: Record<string, string>;
  locale: string | null;
  password_hash: string | null;
}

export interface WorkOSSession extends Entity {
  object: 'session';
  user_id: string;
  organization_id: string | null;
  ip_address: string | null;
  user_agent: string | null;
}

export interface WorkOSEmailVerification extends Entity {
  object: 'email_verification';
  user_id: string;
  email: string;
  code: string;
  expires_at: string;
}

export interface WorkOSPasswordReset extends Entity {
  object: 'password_reset';
  user_id: string;
  email: string;
  token: string;
  expires_at: string;
}

export interface WorkOSMagicAuth extends Entity {
  object: 'magic_auth';
  user_id: string;
  email: string;
  code: string;
  expires_at: string;
}

export interface WorkOSAuthenticationFactor extends Entity {
  object: 'authentication_factor';
  user_id: string;
  type: 'totp';
  totp: {
    issuer: string;
    user: string;
    uri: string;
  };
}

export interface WorkOSAuthorizationCode extends Entity {
  user_id: string;
  organization_id: string | null;
  code: string;
  redirect_uri: string;
  expires_at: string;
  code_challenge: string | null;
  code_challenge_method: string | null;
}

export interface WorkOSIdentity extends Entity {
  object: 'identity';
  user_id: string;
  provider: string;
  provider_id: string;
  type: 'OAuth';
}

export type WorkOSConnectionType =
  | 'ADFSSAML'
  | 'AzureSAML'
  | 'GenericOIDC'
  | 'GenericSAML'
  | 'GoogleOAuth'
  | 'GoogleSAML'
  | 'OktaSAML'
  | 'OneLoginSAML'
  | 'PingFederateSAML'
  | 'PingOneSAML'
  | 'GitHubOAuth'
  | 'MicrosoftOAuth'
  | 'AppleOAuth';

export interface WorkOSConnectionDomain {
  object: 'connection_domain';
  id: string;
  domain: string;
}

export interface WorkOSConnection extends Entity {
  object: 'connection';
  organization_id: string;
  connection_type: WorkOSConnectionType;
  name: string;
  state: 'active' | 'inactive' | 'validating';
  domains: WorkOSConnectionDomain[];
}

export interface WorkOSSSOProfile extends Entity {
  object: 'profile';
  connection_id: string;
  connection_type: WorkOSConnectionType;
  organization_id: string;
  idp_id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  groups: string[];
  raw_attributes: Record<string, unknown>;
}

export interface WorkOSSSOAuthorization extends Entity {
  code: string;
  connection_id: string;
  organization_id: string;
  profile_id: string;
  redirect_uri: string;
  state: string | null;
  expires_at: string;
}
