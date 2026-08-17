/** @type {import('next').NextConfig} */
const nextConfig = {
  async headers() {
    return [
      {
        // The extension's content script fetches this route from arbitrary
        // origins via the background service worker, not the page itself,
        // so a permissive CORS policy here is safe.
        source: "/api/:path*",
        headers: [
          { key: "Access-Control-Allow-Origin", value: "*" },
          { key: "Access-Control-Allow-Methods", value: "POST, OPTIONS" },
          { key: "Access-Control-Allow-Headers", value: "Content-Type" },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
