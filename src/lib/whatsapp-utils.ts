import { CountryCode } from 'libphonenumber-js';
import { normalizePhone } from './phone-normalizer';

export interface WhatsAppLinkResult {
  isValid: boolean;
  cleanDigits: string;
  waUrl: string | null;
  errorMessage?: string;
}

/** Build a WhatsApp URL only from a validated international number. */
export function buildWhatsAppLink(
  rawPhone: string | null | undefined,
  defaultCountry: CountryCode = 'EG'
): WhatsAppLinkResult {
  const result = normalizePhone(rawPhone ?? '', defaultCountry);
  if (!result.isValid) {
    return {
      isValid: false,
      cleanDigits: '',
      waUrl: null,
      errorMessage: result.error ?? 'رقم الهاتف غير صالح.',
    };
  }
  const cleanDigits = result.phoneNormalized.replace(/^\+/, '');
  return { isValid: true, cleanDigits, waUrl: 'https://wa.me/' + cleanDigits };
}
