/**
 * arabic-normalizer.ts
 * أداة عامة لتطبيع النصوص العربية للبحث في أسماء العملاء والخدمات
 */

export function normalizeArabicText(input: unknown): string {
  if (typeof input !== 'string') return '';

  return input
    .trim()
    // إزالة التشكيل (الحركات) والتطويل
    .replace(/[\u064B-\u065F\u0670\u0640]/g, '')
    // توحيد أشكال الألف (أ، إ، آ، ٱ -> ا)
    .replace(/[أإآٱ]/g, 'ا')
    // توحيد التاء المربوطة والهاء (ة -> ه)
    .replace(/ة/g, 'ه')
    // توحيد الياء والألف المقصورة (ى -> ي)
    .replace(/ى/g, 'ي')
    // إزالة علامات التوجيه والتحكم الثنائي BiDi
    .replace(/[\u200E\u200F\u202A-\u202E\u2066-\u2069]/g, '')
    // دمج المسافات المتعددة في مسافة واحدة
    .replace(/\s+/g, ' ')
    // تحويل الحروف اللاتينية إن وجدت إلى حروف صغيرة
    .toLowerCase();
}

/**
 * فحص ما إذا كان نصان عربيان متطابقين بعد التطبيع
 */
export function areArabicTextsEqual(a: unknown, b: unknown): boolean {
  return normalizeArabicText(a) === normalizeArabicText(b);
}
