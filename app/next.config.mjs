/** @type {import('next').NextConfig} */
const nextConfig = {
  // These break when webpack bundles them into the server build; load them
  // from node_modules at runtime instead.
  //   pdf-parse (pdfjs-dist) + mammoth: text extraction in lib/reference.ts
  //   bonjour-service: multicast DNS sockets in lib/ableton/discovery.ts,
  //     which silently found zero hosts when bundled
  serverExternalPackages: ["pdf-parse", "mammoth", "bonjour-service"],
};

export default nextConfig;
