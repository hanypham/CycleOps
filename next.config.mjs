/** @type {import('next').NextConfig} */
const nextConfig = {
  // Ensure API routes only run server-side
  experimental: {
    serverComponentsExternalPackages: ["@prisma/client"],
  },
  // Security headers
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline' https://web.squarecdn.com",
              "style-src 'self' 'unsafe-inline'",
              "frame-src https://web.squarecdn.com",
              "connect-src 'self' https://connect.squareupsandbox.com https://connect.squareup.com",
              "img-src 'self' data:",
            ].join("; "),
          },
        ],
      },
    ];
  },
};

export default nextConfig;
