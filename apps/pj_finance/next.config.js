/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['shared'],
  serverExternalPackages: ['duckdb'],
  eslint: { ignoreDuringBuilds: true },
  webpack: (config, { isServer }) => {
    config.module.rules.push({
      test: /\.ya?ml$/,
      type: 'asset/source',
    });
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
