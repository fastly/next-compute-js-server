import type { Configuration } from 'webpack';

export default function webpackTransform(config: Configuration, webpack: any) {

  return {
    ...config,
    plugins: [
      ...config.plugins ?? [],
      new webpack.ProvidePlugin({
        Buffer: [ 'buffer', 'Buffer' ],
        process: 'process',
      }),
      new webpack.EnvironmentPlugin({
        NEXT_RUNTIME: 'edge',
      }),
      new webpack.optimize.LimitChunkCountPlugin({
        maxChunks: 1,
      }),
    ],
    resolve: {
      ...config.resolve,
      alias: {
        ...config.resolve?.alias,
        'next/dist/compiled/raw-body': require.resolve('raw-body'),
      },
      fallback: {
        ...config.resolve?.fallback,
        url: require.resolve('url/'), // routing-utils needs this
        "@builder.io/partytown/integration": false, // to silence webpack
        "buffer": require.resolve("buffer/"),
        "crypto": require.resolve("crypto-browserify/"),
        "events": require.resolve("events/"),
        "stream": require.resolve("stream-browserify"),
        "os": require.resolve("os-browserify/browser"),
        "path": require.resolve("path-browserify"),
        "process": require.resolve("process/browser"),
        "querystring": require.resolve("querystring-es3"),
        "util": require.resolve("util/"),
      },
    },
  };

}
