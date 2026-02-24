/** @type {import('next').NextConfig} */
const BASE_PATH = '/finance';
const nextConfig = {
  basePath: BASE_PATH,
  env: { NEXT_PUBLIC_BASE_PATH: BASE_PATH },
  transpilePackages: ['shared'],
  serverExternalPackages: ['duckdb'],
  eslint: { ignoreDuringBuilds: true },
  webpack: (config, { isServer }) => {
    if (isServer) {
      config.externals = config.externals || [];
      config.externals.push(({ request }, callback) => {
        if (
          request === 'duckdb' ||
          request?.startsWith('duckdb/') ||
          request === '@mapbox/node-pre-gyp' ||
          request?.startsWith('@mapbox/node-pre-gyp') ||
          request === 'node-gyp' ||
          request?.startsWith('node-gyp/') ||
          request === 'aws-sdk'
        ) {
          return callback(null, 'commonjs ' + request);
        }
        callback();
      });
    }
    return config;
  },
};

module.exports = nextConfig;
