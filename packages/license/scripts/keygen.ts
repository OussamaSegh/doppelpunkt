/**
 * Generates the production Ed25519 keypair for license tokens.
 *   npm run keygen -w @doppelpunkt/license [-- --kid k2026]
 * Prints the private key (PKCS#8, base64url) for `wrangler secret put LICENSE_PRIVATE_KEY` and the
 * public key line for the app build (VITE_LICENSE_PUBLIC_KEYS). Nothing is written to disk.
 */
export {};

const args = process.argv.slice(2);
const i = args.indexOf('--kid');
const kid = (i >= 0 && args[i + 1]) || `k${new Date().getFullYear()}`;
if (!/^[\w-]{1,32}$/.test(kid) || kid === 'test') {
  console.error('keygen: --kid must be 1-32 letters, digits, _ or - and not "test"');
  process.exit(1);
}
const pair = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])) as CryptoKeyPair;
const b64 = (buf: ArrayBuffer) => Buffer.from(buf).toString('base64url');
const pub = b64(await crypto.subtle.exportKey('raw', pair.publicKey));
const priv = b64(await crypto.subtle.exportKey('pkcs8', pair.privateKey));

console.log(`Key id: ${kid}\n`);
console.log('1. Billing Worker secrets (services/billing):');
console.log(`   echo '${priv}' | npx wrangler secret put LICENSE_PRIVATE_KEY`);
console.log(`   LICENSE_KEY_ID = "${kid}"   (wrangler.toml [vars])\n`);
console.log('2. App build variable (public, safe to commit to CI variables):');
console.log(`   VITE_LICENSE_PUBLIC_KEYS=${kid}:${pub}\n`);
console.log('Keep the private key only in the Worker secret and an offline backup (password manager).');
console.log('Losing it means new tokens need a new key id; tokens already issued keep working while the');
console.log('old public key stays in VITE_LICENSE_PUBLIC_KEYS.');
