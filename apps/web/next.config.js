/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: {
    ignoreDuringBuilds: process.env.SENKO_SKIP_ESLINT_BUILD === '1',
  },
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '**' },
      { protocol: 'http', hostname: 'localhost' },
    ],
  },
  /** Dev: memory webpack cache avoids broken `.next/cache/.../*.pack.gz` on Windows (locks / partial deletes). */
  webpack: (config, { dev, isServer }) => {
    if (dev) {
      config.cache = { type: 'memory' };
    }
    if (dev && !isServer && config.output) {
      config.output.chunkLoadTimeout = 300000; // slow disk / AV
    }
    if (!dev && typeof config.parallelism === 'number' && config.parallelism > 4) {
      config.parallelism = 4;
    }
    return config;
  },
};

module.exports = nextConfig;
