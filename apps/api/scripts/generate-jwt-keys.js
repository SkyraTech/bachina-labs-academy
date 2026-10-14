const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/**
 * Generates an RSA 2048 keypair for RS256 JWT access token signing & verification.
 * Output: apps/api/certs/jwt-private.pem and apps/api/certs/jwt-public.pem
 */
function generateKeys() {
  const certsDir = path.resolve(__dirname, '../certs');
  if (!fs.existsSync(certsDir)) {
    fs.mkdirSync(certsDir, { recursive: true });
  }

  const privateKeyPath = path.join(certsDir, 'jwt-private.pem');
  const publicKeyPath = path.join(certsDir, 'jwt-public.pem');

  if (fs.existsSync(privateKeyPath) && fs.existsSync(publicKeyPath)) {
    console.log('JWT RSA keys already exist at:');
    console.log('  Private:', privateKeyPath);
    console.log('  Public: ', publicKeyPath);
    return;
  }

  console.log('Generating RSA 2048-bit keypair for RS256 JWT signing...');
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: {
      type: 'spki',
      format: 'pem',
    },
    privateKeyEncoding: {
      type: 'pkcs8',
      format: 'pem',
    },
  });

  fs.writeFileSync(privateKeyPath, privateKey, { mode: 0o600 });
  fs.writeFileSync(publicKeyPath, publicKey, { mode: 0o644 });

  console.log('Successfully generated RSA keys:');
  console.log('  Private key (0600):', privateKeyPath);
  console.log('  Public key  (0644):', publicKeyPath);
}

generateKeys();
