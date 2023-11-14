# Next.js Runtime Server on Fastly Compute

This is an implementation of Next.js's BaseServer for
Fastly Compute, and the behavior is modeled highly off of NextNodeServer.
It enables running pages and API routes that target the `nodejs` runtime
on Compute.

NextWebServer (the Edge Runtime version) should be possible to run without
this port.

There is a separate library that corresponds to each release of Next.js,
maintained in separate branches of this library.

The versions of Next.js that this library is compatible with are listed in the
COMPATIBLE_NEXT_VERSIONS constant in `./src/node/function-transform/constants.ts`.

## Usage

This library is typically used with `@fastly/next-compute-js`, to implement the runtime
for pages and API routes that target the `nodejs` runtime. See `@fastly/next-compute-js` for
more details.

## Issues

If you encounter any non-security-related bug or unexpected behavior, please [file an issue][bug]
using the bug report template.

[bug]: https://github.com/fastly/next-compute-js-server/issues/new?labels=bug

### Security issues

Please see our [SECURITY.md](./SECURITY.md) for guidance on reporting security-related issues.

## License

[MIT](./LICENSE).
