import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Netlify 由其官方 Next 运行时接管打包部署，standalone 仅用于自托管
  ...(process.env.NETLIFY ? {} : { output: "standalone" }),
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
};

export default nextConfig;
