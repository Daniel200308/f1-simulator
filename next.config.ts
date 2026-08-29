import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // The dev-tools launcher sits over the qualifying tyre selector on compact
  // viewports. Keep the local game surface interaction-safe; diagnostics
  // remain available through the terminal and browser developer tools.
  devIndicators: false,
  allowedDevOrigins: ["127.0.0.1", "localhost", "192.168.0.*"],
  turbopack: {
    root: process.cwd(),
  },
};

export default nextConfig;
