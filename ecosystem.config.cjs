// ecosystem.config.cjs
// ملف إدارة العمليات لـ PM2 وسيرفرات Node.js على استضافة Hostinger Cloud

module.exports = {
  apps: [
    {
      name: 'mycrmsalon',
      script: './scripts/start-standalone.mjs',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'production',
        PORT: process.env.PORT || 3000,
      },
    },
  ],
};
