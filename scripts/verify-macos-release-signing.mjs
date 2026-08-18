import { readFileSync } from 'node:fs';

const config = JSON.parse(
  readFileSync(new URL('../src-tauri/tauri.macos.conf.json', import.meta.url)),
);
const identity = config?.bundle?.macOS?.signingIdentity;
const required = [
  'APPLE_CERTIFICATE',
  'APPLE_CERTIFICATE_PASSWORD',
  'KEYCHAIN_PASSWORD',
  'APPLE_ID',
  'APPLE_PASSWORD',
  'APPLE_TEAM_ID',
];
const missing = required.filter((name) => !process.env[name]?.trim());

if (identity === '-' || missing.length > 0) {
  const detail = [
    identity === '-' ? 'tauri.macos.conf.json still selects ad-hoc signing' : null,
    missing.length > 0 ? `missing ${missing.join(', ')}` : null,
  ]
    .filter(Boolean)
    .join('; ');
  console.error(`macOS release signing is not configured: ${detail}`);
  process.exit(1);
}
