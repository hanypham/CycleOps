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
              "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://web.squarecdn.com",
              "style-src 'self' 'unsafe-inline' https://web.squarecdn.com",
              "font-src 'self' https://web.squarecdn.com",
              "frame-src https://web.squarecdn.com",
              "connect-src 'self' https://connect.squareupsandbox.com https://connect.squareup.com https://pci-connect.squareup.com https://pci-connect.squareupsandbox.com https://o160250.ingest.sentry.io",
              "img-src 'self' data: https://web.squarecdn.com",
            ].join("; "),
          },
        ],
      },
    ];
  },
};

export default nextConfig;
