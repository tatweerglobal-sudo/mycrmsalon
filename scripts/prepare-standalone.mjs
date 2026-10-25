// scripts/prepare-standalone.mjs
// تجهيز حزمة النشر المستقلة (Standalone) لبيئة استضافة Hostinger Node.js Web App
// يقوم بنسخ ملفات .next/static و public تلقائياً داخل .next/standalone

import fs from 'node:fs';
import path from 'node:path';

const rootDir = process.cwd();
const standaloneDir = path.join(rootDir, '.next', 'standalone');

if (!fs.existsSync(standaloneDir)) {
  console.error('❌ لم يتم العثور على مجلد .next/standalone. يرجى تشغيل next build أولاً.');
  process.exit(1);
}

console.log('📦 جاري تجهيز ملفات النشر المستقلة لـ Hostinger Node.js...');

// 1. نسخ .next/static
const srcStatic = path.join(rootDir, '.next', 'static');
const dstStatic = path.join(standaloneDir, '.next', 'static');
if (fs.existsSync(srcStatic)) {
  fs.cpSync(srcStatic, dstStatic, { recursive: true, force: true });
  console.log('✔ تم نسخ .next/static بنجاح.');
}

// 2. نسخ public
const srcPublic = path.join(rootDir, 'public');
const dstPublic = path.join(standaloneDir, 'public');
if (fs.existsSync(srcPublic)) {
  fs.cpSync(srcPublic, dstPublic, { recursive: true, force: true });
  console.log('✔ تم نسخ مجلد public بنجاح.');
}

console.log('🎉 اكتمل تجهيز الحزمة المستقلة بنجاح داخل: .next/standalone');
console.log('💡 للتشغيل المحلي أو على السيرفر:');
console.log('   cd .next/standalone && node server.js');
