import test from 'node:test';
import assert from 'node:assert/strict';
import {
  decryptDeploymentSecret,
  encryptDeploymentSecret
} from '../src/services/deploymentPayloadCrypto.js';

test('encrypts deployment secrets with authenticated encryption', () => {
  const plaintext = 'cfxk_sensitive-license';
  const encrypted = encryptDeploymentSecret(plaintext);
  assert.ok(encrypted);
  assert.equal(encrypted.includes(plaintext), false);
  assert.equal(decryptDeploymentSecret(encrypted), plaintext);
});

test('rejects modified deployment ciphertext', () => {
  const encrypted = encryptDeploymentSecret('secret');
  const replacement = encrypted.endsWith('A') ? 'B' : 'A';
  assert.throws(() => decryptDeploymentSecret(`${encrypted.slice(0, -1)}${replacement}`));
});
