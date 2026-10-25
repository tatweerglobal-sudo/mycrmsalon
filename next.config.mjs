/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  swcMinify: true,
  output: process.env.NEXT_OUTPUT_EXPORT === 'true' ? 'export' : 'standalone',
  ...(process.env.NEXT_OUTPUT_EXPORT === 'true'
    ? {
        images: { unoptimized: true },
        trailingSlash: true,
      }
    : {}),
};

export default nextConfig;
