// scripts/start-standalone.mjs
// تشغيل سيرفر الإنتاج المستقل (Next.js Standalone Production Server)
// يقوم بتحميل متغيرات .env.local والاتصال بقاعدة بيانات Neon مباشرة دون الحاجة لـ tsx

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const rootDir = process.cwd();
const envPath = path.join(rootDir, '.env.local');

if (fs.existsSync(envPath)) {
  const content = fs.readFileSync(envPath, 'utf8');
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx !== -1) {
      const key = trimmed.slice(0, eqIdx).trim();
      let val = trimmed.slice(eqIdx + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (!process.env[key]) {
        process.env[key] = val;
      }
    }
  }
}

const PORT = process.env.PORT || '3000';
const standaloneDir = path.join(rootDir, '.next', 'standalone');
const serverScript = path.join(standaloneDir, 'server.js');

if (!fs.existsSync(serverScript)) {
  console.error('❌ لم يتم العثور على .next/standalone/server.js. يرجى تشغيل npm run build:standalone أولاً.');
  process.exit(1);
}

console.log('=============================================================');
console.log(`🚀 تشغيل سيرفر My CRM Salon المستقل على: http://localhost:${PORT}`);
console.log('=============================================================');

const serverProcess = spawn(process.execPath, [serverScript], {
  cwd: standaloneDir,
  env: {
    ...process.env,
    PORT: String(PORT),
    HOSTNAME: '0.0.0.0',
  },
  stdio: 'inherit',
});

serverProcess.on('exit', (code) => {
  console.log(`السيرفر توقف بكود: ${code}`);
  process.exit(code || 0);
});

process.on('SIGINT', () => {
  serverProcess.kill('SIGINT');
  process.exit(0);
});

process.on('SIGTERM', () => {
  serverProcess.kill('SIGTERM');
  process.exit(0);
});
