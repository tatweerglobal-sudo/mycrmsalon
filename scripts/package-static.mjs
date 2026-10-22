import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const rootDir = process.cwd();
const outDir = path.join(rootDir, 'out');
const zipFile = path.join(rootDir, 'mycrmsalon-static.zip');

console.log('📦 جاري تجهيز حزمة النشر الثابت (ZIP) لـ Hostinger...');

if (!fs.existsSync(outDir)) {
  console.error('❌ مجلد out/ غير موجود! يرجى تنفيذ npm run build:static أولاً.');
  process.exit(1);
}

const indexHtml = path.join(outDir, 'index.html');
if (!fs.existsSync(indexHtml)) {
  console.error('❌ out/index.html غير موجود! البناء غير مكتمل.');
  process.exit(1);
}

// إذا كان الملف موجوداً سابقاً نقوم بحذفه
if (fs.existsSync(zipFile)) {
  fs.unlinkSync(zipFile);
}

const isWindows = process.platform === 'win32';

if (isWindows) {
  // ضغط محتويات مجلد out فقط دون المجلد نفسه ودون source code أو node_modules
  const psCommand = `Compress-Archive -Path "${outDir}\\*" -DestinationPath "${zipFile}" -Force`;
  const res = spawnSync('powershell.exe', ['-NoProfile', '-Command', psCommand], {
    stdio: 'inherit',
    shell: true,
  });

  if (res.status !== 0) {
    console.error('❌ فشل ضغط الملفات عبر PowerShell!');
    process.exit(res.status ?? 1);
  }
} else {
  // في Linux أو macOS
  const res = spawnSync('sh', ['-c', `cd "${outDir}" && zip -r "${zipFile}" ./*`], {
    stdio: 'inherit',
  });

  if (res.status !== 0) {
    console.error('❌ فشل ضغط الملفات عبر zip!');
    process.exit(res.status ?? 1);
  }
}

const stats = fs.statSync(zipFile);
const sizeKb = (stats.size / 1024).toFixed(1);
console.log(`✅ تم إنشاء حزمة النشر بنجاح: mycrmsalon-static.zip (${sizeKb} KB)`);
console.log('✨ تحتوي الحزمة على محتويات out/ المباشرة وجاهزة للرفع إلى public_html على Hostinger.');
