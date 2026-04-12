import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

interface DeviceIdentity {
  deviceId: string;
  publicKeyRaw: Buffer;
  publicKeyB64url: string;
  privateKeyPem: string;
}

let cached: DeviceIdentity | null = null;

function identityPath(): string {
  const dir = process.env.CLAWDECK_DATA_DIR
    || path.join(process.env.HOME || process.cwd(), '.clawdeck');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  return path.join(dir, 'device-identity.json');
}

export function getDeviceIdentity(): DeviceIdentity {
  if (cached) return cached;

  const idPath = identityPath();

  if (fs.existsSync(idPath)) {
    try {
      const stored = JSON.parse(fs.readFileSync(idPath, 'utf-8'));
      if (stored.publicKeyB64url && stored.privateKeyPem && stored.deviceId) {
        cached = {
          deviceId: stored.deviceId,
          publicKeyRaw: Buffer.from(stored.publicKeyB64url, 'base64url'),
          publicKeyB64url: stored.publicKeyB64url,
          privateKeyPem: stored.privateKeyPem,
        };
        console.log(`[device-identity] Loaded existing identity: ${cached.deviceId.substring(0, 12)}…`);
        return cached;
      }
    } catch (err) {
      console.warn('[device-identity] Failed to load identity, regenerating:', (err as Error).message);
    }
  }

  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const pubDer = publicKey.export({ type: 'spki', format: 'der' });
  const rawPub = pubDer.slice(-32);
  const pubB64url = rawPub.toString('base64url');
  const deviceId = crypto.createHash('sha256').update(rawPub).digest('hex');
  const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;

  cached = {
    deviceId,
    publicKeyRaw: rawPub,
    publicKeyB64url: pubB64url,
    privateKeyPem,
  };

  const stored = {
    deviceId,
    publicKeyB64url: pubB64url,
    privateKeyPem,
    createdAt: new Date().toISOString(),
  };
  fs.writeFileSync(idPath, JSON.stringify(stored, null, 2) + '\n', { mode: 0o600 });
  console.log(`[device-identity] Generated new identity: ${deviceId.substring(0, 12)}… → ${idPath}`);

  return cached;
}

export function buildSigningPayload(params: {
  deviceId: string;
  clientId: string;
  clientMode: string;
  role: string;
  scopes: string[];
  signedAtMs: number;
  token: string;
  nonce: string;
}): string {
  return [
    'v2',
    params.deviceId,
    params.clientId,
    params.clientMode,
    params.role,
    params.scopes.join(','),
    String(params.signedAtMs),
    params.token,
    params.nonce,
  ].join('|');
}

export function signPayload(privateKeyPem: string, payload: string): string {
  const key = crypto.createPrivateKey(privateKeyPem);
  return crypto.sign(null, Buffer.from(payload, 'utf8'), key).toString('base64url');
}

export function createDeviceBlock(params: {
  clientId: string;
  clientMode: string;
  role: string;
  scopes: string[];
  token: string;
  nonce: string;
}): {
  id: string;
  publicKey: string;
  signature: string;
  signedAt: number;
  nonce: string;
} {
  const identity = getDeviceIdentity();
  const signedAt = Date.now();

  const payload = buildSigningPayload({
    deviceId: identity.deviceId,
    clientId: params.clientId,
    clientMode: params.clientMode,
    role: params.role,
    scopes: params.scopes,
    signedAtMs: signedAt,
    token: params.token,
    nonce: params.nonce,
  });

  const signature = signPayload(identity.privateKeyPem, payload);

  return {
    id: identity.deviceId,
    publicKey: identity.publicKeyB64url,
    signature,
    signedAt,
    nonce: params.nonce,
  };
}