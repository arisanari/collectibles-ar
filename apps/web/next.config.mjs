/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Dev only: lets a phone reach `next dev` through an HTTPS tunnel (camera needs a secure origin).
  allowedDevOrigins: ["*.trycloudflare.com", "*.lhr.life"],
};

export default nextConfig;
