/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: { tsconfigPath: process.env.STUDIO_TSCONFIG || "tsconfig.json" },
  distDir: process.env.STUDIO_NEXT_DIST_DIR || ".next",
  // These break when webpack bundles them into the server build; load them
  // from node_modules at runtime instead.
  //   pdf-parse (pdfjs-dist) + mammoth: text extraction in lib/reference.ts
  //   bonjour-service: multicast DNS sockets in lib/ableton/discovery.ts,
  //     which silently found zero hosts when bundled
  serverExternalPackages: ["pdf-parse", "mammoth", "bonjour-service", "googleapis", "nodemailer"],
};

export default nextConfig;
