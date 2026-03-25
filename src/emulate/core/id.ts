const ENCODING = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // Crockford's Base32
const ENCODING_LEN = ENCODING.length; // 32
const TIME_LEN = 10; // 10 chars encodes 48-bit ms timestamp
const RANDOM_LEN = 16; // 16 chars of randomness

let lastTime = 0;

export function generateId(prefix: string): string {
  let now = Date.now();
  if (now <= lastTime) {
    now = lastTime + 1;
  }
  lastTime = now;

  let timeStr = '';
  let t = now;
  for (let i = TIME_LEN - 1; i >= 0; i--) {
    timeStr = ENCODING[t % ENCODING_LEN] + timeStr;
    t = Math.floor(t / ENCODING_LEN);
  }

  let randStr = '';
  for (let i = 0; i < RANDOM_LEN; i++) {
    randStr += ENCODING[Math.floor(Math.random() * ENCODING_LEN)];
  }

  return `${prefix}_${timeStr}${randStr}`;
}

export function resetIdState(): void {
  lastTime = 0;
}

export const ID_PREFIXES = {
  user: 'user',
  organization: 'org',
  organization_membership: 'om',
  organization_domain: 'org_domain',
  connection: 'conn',
  connection_domain: 'conn_domain',
  directory: 'directory',
  directory_user: 'directory_user',
  directory_group: 'directory_grp',
  event: 'event',
  invitation: 'inv',
  session: 'session',
  email_verification: 'email_verification',
  password_reset: 'password_reset',
  magic_auth: 'magic_auth',
  authentication_factor: 'auth_factor',
  authentication_challenge: 'auth_challenge',
  api_key: 'api_key',
  profile: 'prof',
  pipe_connection: 'pipe_conn',
  audit_log_action: 'audit_action',
  audit_log_event: 'audit_event',
  audit_log_export: 'audit_export',
  feature_flag: 'ff',
  flag_target: 'ff_target',
  connect_application: 'connect_app',
  client_secret: 'client_secret',
  data_integration_auth: 'di_auth',
  radar_attempt: 'radar_attempt',
} as const;
