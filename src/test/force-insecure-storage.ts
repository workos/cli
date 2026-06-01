import { setInsecureStorage } from '../lib/credentials.js';
import { setInsecureConfigStorage } from '../lib/config-store.js';

// Subprocess integration tests import bin.ts directly, which initializes
// telemetry before command options are parsed. Flip the existing storage seams
// first so startup auth lookup stays inside the test's temporary HOME instead
// of touching the host keychain.
setInsecureStorage(true);
setInsecureConfigStorage(true);
