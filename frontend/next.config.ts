import type { NextConfig } from "next";
const config: NextConfig = {
 output: "standalone",
 experimental: { proxyTimeout: (Math.max(Number(process.env.OPTIMIZATION_TIMEOUT_SECONDS || 60), Number(process.env.API_TIMEOUT_SECONDS || 60)) + 15) * 1000 },
 async rewrites() { return [{source: "/api/:path*", destination: "http://api:8000/:path*"}]; },
 turbopack: { rules: {"*.css": {loaders: ["@tailwindcss/turbopack"], as: "*.css"}}}
};
export default config;
