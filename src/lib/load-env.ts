// src/lib/load-env.ts
// تحميل تلقائي وآمن لملفات المتغيرات البيئية المحلية (.env.local و .env)
// لضمان تحميل إعدادات قاعدة بيانات Neon دون الحاجة لأي اعتماديات خارجية

import fs from 'node:fs';
import path from 'node:path';

export function loadEnvFiles(): void {
  const cwd = process.cwd();
  // الترتيب: .env.local أولاً لتجاوز القيم الافتراضية، ثم .env
  const envFiles = ['.env.local', '.env'];

  for (const file of envFiles) {
    const fullPath = path.join(cwd, file);
    if (!fs.existsSync(fullPath)) {
      continue;
    }

    try {
      const content = fs.readFileSync(fullPath, 'utf-8');
      const lines = content.split(/\r?\n/);

      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line || line.startsWith('#')) {
          continue;
        }

        const eqIdx = line.indexOf('=');
        if (eqIdx <= 0) {
          continue;
        }

        const key = line.slice(0, eqIdx).trim();
        let val = line.slice(eqIdx + 1).trim();

        // إزالة علامات الاقتباس إن وجدت
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }

        // ضبط المتغير إذا لم يكن موجوداً في بيئة النظام الأصلية
        if (process.env[key] === undefined) {
          process.env[key] = val;
        }
      }
    } catch {
      // تجاهل أخطاء القراءة
    }
  }
}

// تحميل فوري عند الاستيراد
loadEnvFiles();
