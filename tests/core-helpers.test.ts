import { test } from 'node:test';
import assert from 'node:assert/strict';
import { convertArabicIndicDigits, normalizePhone } from '../src/lib/phone-normalizer';
import { normalizeArabicText } from '../src/lib/arabic-normalizer';
import { buildWhatsAppLink } from '../src/lib/whatsapp-utils';
import { hashPassword, verifyPassword } from '../src/lib/auth/password';

test('Arabic-Indic and Persian digits normalize', () => {
  assert.equal(convertArabicIndicDigits('٠١٢۳۴'), '01234');
});

test('Egyptian customer phone normalizes to E.164', () => {
  assert.equal(normalizePhone('01012345678', 'EG').phoneNormalized, '+201012345678');
});

test('Saudi customer phone normalization uses chosen country', () => {
  assert.equal(normalizePhone('0501234567', 'SA').phoneNormalized, '+966501234567');
});

test('ambiguous local phone is rejected', () => {
  assert.equal(normalizePhone('12345', 'EG').isValid, false);
});

test('Arabic name search comparison normalizes accents', () => {
  assert.equal(normalizeArabicText(' أَمينَة '), normalizeArabicText('امينة'));
});

test('WhatsApp URL never uses an unvalidated phone', () => {
  assert.equal(buildWhatsAppLink('junk').waUrl, null);
  assert.equal(buildWhatsAppLink('+966501234567').waUrl, 'https://wa.me/966501234567');
});

test('Password helper hashes, validates and rejects weak passwords', async () => {
  await assert.rejects(hashPassword('short'));
  const hash = await hashPassword('Sal0n!secure#2026');
  assert.notEqual(hash, 'Sal0n!secure#2026');
  assert.equal(await verifyPassword('Sal0n!secure#2026', hash), true);
  assert.equal(await verifyPassword('wrong', hash), false);
});
