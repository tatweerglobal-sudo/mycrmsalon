import { spawnSync } from 'node:child_process';

process.env.NEXT_OUTPUT_EXPORT = 'true';

console.log('🚀 بدء بناء النسخة الثابتة (Static Export)...');
const isWindows = process.platform === 'win32';
const nextCmd = isWindows ? 'npx.cmd' : 'npx';

const result = spawnSync(nextCmd, ['next', 'build'], {
  stdio: 'inherit',
  shell: true,
  env: {
    ...process.env,
    NEXT_OUTPUT_EXPORT: 'true',
  },
});

if (result.status !== 0) {
  console.error('❌ فشل بناء النسخة الثابتة!');
  process.exit(result.status ?? 1);
}

console.log('✅ تم بناء النسخة الثابتة بنجاح داخل مجلد out/');
