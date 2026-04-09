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
  /** Dev-only: slow Windows disk / AV can exceed default chunk load and cause ChunkLoadError */
  webpack: (config, { dev, isServer }) => {
    if (dev && !isServer && config.output) {
      config.output.chunkLoadTimeout = 300000;
    }
    if (!dev && typeof config.parallelism === 'number' && config.parallelism > 4) {
      config.parallelism = 4;
    }
    return config;
  },
};

module.exports = nextConfig;
