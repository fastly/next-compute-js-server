import type { Configuration } from 'webpack';
import path from "path";

const EMPTY_MODULE = path.resolve(__dirname, '../../server/lib/empty-module');

let compiled: Record<string, string> = {};
try {
  require.resolve('@opentelemetry/api');
} catch {
  compiled['@opentelemetry/api'] = 'next/dist/compiled/@opentelemetry/api';
}

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
      new webpack.NormalModuleReplacementPlugin(
        /\/lib\/server-ipc\/invoke-request$/,
        EMPTY_MODULE,
      ),
    ],
    resolve: {
      ...config.resolve,
      alias: {
        ...config.resolve?.alias,
        ...compiled,
        'next/dist/compiled/raw-body': require.resolve('raw-body'),
        'react-dom/server.edge$': EMPTY_MODULE,
        'react-server-dom-webpack/client$': EMPTY_MODULE,
        'react-server-dom-webpack/client.edge$': EMPTY_MODULE,
        'react-server-dom-webpack/server.edge$': EMPTY_MODULE,
        'react-server-dom-webpack/server.node$': EMPTY_MODULE,
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
