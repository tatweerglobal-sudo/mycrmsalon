import { parsePhoneNumber, CountryCode } from 'libphonenumber-js';

export interface PhoneNormalizationResult {
  isValid: boolean;
  phoneRaw: string;
  phoneNormalized: string;
  countryCode?: string;
  error?: string;
}

/**
 * تحويل الأرقام العربية الهندية والفارسية إلى أرقام لاتينية قياسية
 */
export function convertArabicIndicDigits(input: string): string {
  const arabicIndic = '٠١٢٣٤٥٦٧٨٩';
  const easternPersian = '۰۱۲۳۴۵۶۷۸۹';
  return (input || '')
    .replace(/[٠-٩]/g, d => String(arabicIndic.indexOf(d)))
    .replace(/[۰-۹]/g, d => String(easternPersian.indexOf(d)));
}

/**
 * محرك تطبيع وتوحيد أرقام الهواتف بصيغة E.164 الدولية
 * تدعم مصر افتراضياً مع إمكانية تحديد الدولة لكل مركز تجميل
 */
export function normalizePhone(rawInput: string, defaultCountry: CountryCode = 'EG'): PhoneNormalizationResult {
  if (!rawInput || typeof rawInput !== 'string') {
    return {
      isValid: false,
      phoneRaw: '',
      phoneNormalized: '',
      error: 'رقم الهاتف مطلوب.',
    };
  }

  const cleanedRaw = convertArabicIndicDigits(rawInput.trim());
  // إزالة أي مسافات، أقواس، ونقاط
  let digitsAndPlus = cleanedRaw.replace(/[^\d+]/g, '');

  // معالجة بادئة 00 وتحويلها إلى +
  if (digitsAndPlus.startsWith('00')) {
    digitsAndPlus = '+' + digitsAndPlus.slice(2);
  }

  // إذا كان الرقم مصرياً محلياً يبدأ بـ 01 ومكون من 11 رقماً
  if (defaultCountry === 'EG' && /^01[0125]\d{8}$/.test(digitsAndPlus)) {
    const normalized = '+20' + digitsAndPlus.slice(1);
    return {
      isValid: true,
      phoneRaw: cleanedRaw,
      phoneNormalized: normalized,
      countryCode: 'EG',
    };
  }

  // إذا بدأ بـ + مباشرة، نستخدم libphonenumber-js للتحليل الدولي
  if (digitsAndPlus.startsWith('+')) {
    try {
      const parsed = parsePhoneNumber(digitsAndPlus);
      if (parsed && parsed.isValid()) {
        return {
          isValid: true,
          phoneRaw: cleanedRaw,
          phoneNormalized: parsed.number,
          countryCode: parsed.country,
        };
      }
    } catch (_e) {
      // libphonenumber parsing failed
    }
    return {
      isValid: false,
      phoneRaw: cleanedRaw,
      phoneNormalized: '',
      error: 'رقم الهاتف الدولي غير صالح طبقاً لمعيار E.164.',
    };
  }

  // محاولة التحليل بافتراض الدولة الافتراضية
  try {
    const parsed = parsePhoneNumber(digitsAndPlus, defaultCountry);
    if (parsed && parsed.isValid()) {
      return {
        isValid: true,
        phoneRaw: cleanedRaw,
        phoneNormalized: parsed.number,
        countryCode: parsed.country,
      };
    }
  } catch (_e) {
    // Parsing error
  }

  // في حال كان الرقم ملتبساً (أرقام بدون مفتاح دولة لا تطابق الدولة الافتراضية)
  return {
    isValid: false,
    phoneRaw: cleanedRaw,
    phoneNormalized: '',
    error: 'رقم الهاتف ملتبس؛ يرجى تضمين مفتاح الدولة الدولي (مثل +966 أو +20).',
  };
}
