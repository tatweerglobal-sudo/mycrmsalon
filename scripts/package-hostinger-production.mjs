// scripts/package-hostinger-production.mjs
// حزم ملفات الإنتاج الكاملة في أرشيف مضغوط جاهز للرفع على Hostinger Cloud Professional

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const rootDir = process.cwd();
const standaloneDir = path.join(rootDir, '.next', 'standalone');
const zipFile = path.join(rootDir, 'mycrmsalon-hostinger-production.zip');

console.log('=============================================================');
console.log('📦 تجهيز حزمة إنتاج My CRM Salon لـ Hostinger Cloud Node.js');
console.log('=============================================================');

if (!fs.existsSync(standaloneDir)) {
  console.error('❌ مجلد .next/standalone غير موجود! يرجى تشغيل npm run build:standalone أولاً.');
  process.exit(1);
}

// 1. نسخ ملفات الإدارة والتشغيل لداخل standalone
const scriptsDst = path.join(standaloneDir, 'scripts');
fs.mkdirSync(scriptsDst, { recursive: true });
fs.copyFileSync(
  path.join(rootDir, 'scripts', 'start-standalone.mjs'),
  path.join(scriptsDst, 'start-standalone.mjs')
);

if (fs.existsSync(path.join(rootDir, 'ecosystem.config.cjs'))) {
  fs.copyFileSync(
    path.join(rootDir, 'ecosystem.config.cjs'),
    path.join(standaloneDir, 'ecosystem.config.cjs')
  );
}

// حذف الملف القديم إن وجد
if (fs.existsSync(zipFile)) {
  fs.unlinkSync(zipFile);
}

console.log('🗜️ جاري ضغط ملفات السيرفر والمكتبات والأصول الثابتة...');

const isWindows = process.platform === 'win32';
if (isWindows) {
  const psArgs = [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-Command',
    `Get-ChildItem -Path '${standaloneDir}' -Force | Compress-Archive -DestinationPath '${zipFile}' -Force`,
  ];
  const res = spawnSync('powershell.exe', psArgs, { stdio: 'inherit' });
  if (res.status !== 0) {
    console.error('❌ فشل ضغط الملفات!');
    process.exit(res.status ?? 1);
  }
} else {
  const res = spawnSync('sh', ['-c', `cd "${standaloneDir}" && zip -r "${zipFile}" ./* ./.* -x "./." -x "./.."`], {
    stdio: 'inherit',
  });
  if (res.status !== 0) {
    console.error('❌ فشل ضغط الملفات!');
    process.exit(res.status ?? 1);
  }
}

const stats = fs.statSync(zipFile);
const sizeMb = (stats.size / (1024 * 1024)).toFixed(2);

console.log('=============================================================');
console.log(`✅ تم إنشاء حزمة الإنتاج بنجاح:`);
console.log(`   الملف: mycrmsalon-hostinger-production.zip`);
console.log(`   الحجم: ${sizeMb} MB`);
console.log('=============================================================');
