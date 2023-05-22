/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 *
 * Portions of this file Copyright Vercel, Inc., licensed under the MIT license. See LICENSE file for details.
 */

import { join } from 'path';

import {
  APP_PATHS_MANIFEST,
  BUILD_ID_FILE,
  CLIENT_REFERENCE_MANIFEST,
  FLIGHT_SERVER_CSS_MANIFEST,
  PAGES_MANIFEST,
  PRERENDER_MANIFEST,
  SERVER_DIRECTORY,
  FONT_LOADER_MANIFEST,
} from 'next/constants';
import {
  INSTRUMENTATION_HOOK_FILENAME,
} from "next/dist/lib/constants";

import { PrerenderManifest } from 'next/dist/build';
import { PagesManifest } from 'next/dist/build/webpack/plugins/pages-manifest-plugin';
import { CustomRoutes } from 'next/dist/lib/load-custom-routes';
import { apiResolver } from 'next/dist/server/api-utils/node';
import { BaseNextRequest, BaseNextResponse } from 'next/dist/server/base-http';
import BaseServer, {
  FindComponentsResult,
  NoFallbackError,
  Options,
} from 'next/dist/server/base-server';
import { getCloneableBody } from 'next/dist/server/body-streams';
import { FontManifest } from 'next/dist/server/font-utils';
import { RouteKind } from "next/dist/server/future/route-kind";
import { PagesAPIRouteMatch } from "next/dist/server/future/route-matches/pages-api-route-match";
import { IncrementalCache } from 'next/dist/server/lib/incremental-cache'
import { NextNodeServerSpan } from 'next/dist/server/lib/trace/constants';
import { getTracer } from 'next/dist/server/lib/trace/tracer';
import { RenderOpts, renderToHTML } from 'next/dist/server/render';
import { renderToHTMLOrFlight as appRenderToHTMLOrFlight } from 'next/dist/server/app-render';
import {
  addRequestMeta,
  getRequestMeta,
  NextParsedUrlQuery,
  NextUrlWithParsedQuery,
} from 'next/dist/server/request-meta';
import { Route, RouterOptions } from 'next/dist/server/router';
import { PayloadOptions, sendRenderResult } from 'next/dist/server/send-payload';
import { detectDomainLocale } from 'next/dist/shared/lib/i18n/detect-domain-locale';
import { normalizeLocalePath } from 'next/dist/shared/lib/i18n/normalize-locale-path';
import { normalizePagePath } from 'next/dist/shared/lib/page-path/normalize-page-path';
import { normalizeAppPath } from 'next/dist/shared/lib/router/utils/app-paths';
import getRouteFromAssetPath from 'next/dist/shared/lib/router/utils/get-route-from-asset-path';
import { getPathMatch } from 'next/dist/shared/lib/router/utils/path-match';
import { removeTrailingSlash } from 'next/dist/shared/lib/router/utils/remove-trailing-slash';
import { Params} from 'next/dist/shared/lib/router/utils/route-matcher';
import { PageNotFoundError } from 'next/dist/shared/lib/utils';
import { NodeNextRequest, NodeNextResponse } from 'next/dist/server/base-http/node';

import { toComputeResponse, toReqRes } from '@fastly/http-compute-js';

import {
  getPagePath,
  requireManifest,
  requireModule,
  requireFontManifest,
  readAssetFileAsString, getMaybePagePath,
} from './require';
import { loadComponents } from './load-components';
import ComputeJsResponseCache from './response-cache/compute-js';
import { findDir } from './find-pages-dir';

import type { IncomingMessage, ServerResponse } from 'http';
import type { ParsedUrlQuery } from 'querystring';
import type { MatchOptions } from 'next/dist/server/future/route-matcher-managers/route-matcher-manager';
import type { NodeRequestHandler } from "next/dist/server/next-server";
import type RenderResult from 'next/dist/server/render-result';

export interface ComputeJsServerOptions extends Options {
  computeJsConfig: {
    extendRenderOpts: Partial<BaseServer['renderOpts']>,
  };
}

export type ComputeJsRequestHandler = (request: Request) => Promise<Response>;

/**
 * An implementation of a Next.js server that has been adapted to run in Compute@Edge.
 * (An adaptation for Compute@Edge of NextNodeServer in Next.js,
 * found at next/server/next-server.ts)
 */
export default class NextComputeJsServer extends BaseServer<ComputeJsServerOptions> {
  constructor(options: ComputeJsServerOptions) {
    super(options);

    this.getHasAppDir(false);

    /**
     * This sets environment variable to be used at the time of SSR by head.tsx.
     * Using this from process.env allows targeting both serverless and SSR by calling
     * `process.env.__NEXT_OPTIMIZE_CSS`.
     */
    // if (this.renderOpts.optimizeFonts) {
    //   process.env.__NEXT_OPTIMIZE_FONTS = JSON.stringify(
    //     this.renderOpts.optimizeFonts
    //   );
    // }
    // if (this.renderOpts.optimizeCss) {
    //   process.env.__NEXT_OPTIMIZE_CSS = JSON.stringify(true);
    // }
    // if (this.renderOpts.nextScriptWorkers) {
    //   process.env.__NEXT_SCRIPT_WORKERS = JSON.stringify(true);
    // }

    if (/*!options.dev &&*/ this.nextConfig.experimental.instrumentationHook) {
      (async () => {
        try {
          console.log('instrumentationfile', join(
            options.dir || '.',
            options.conf.distDir!,
            'server',
            INSTRUMENTATION_HOOK_FILENAME
          ));
          const instrumentationHook = await requireModule(join(
            options.dir || '.',
            options.conf.distDir!,
            'server',
            INSTRUMENTATION_HOOK_FILENAME
          ));

          instrumentationHook.register?.();
        } catch (err: any) {
          if (err.code !== 'MODULE_NOT_FOUND') {
            err.message = `An error occurred while loading instrumentation hook: ${err.message}`;
            throw err;
          }
        }
      })();
    }

    // if (!options.dev) {
    //   // We are always in prod mode, so we should always be in here
    //
    //   // pre-warm _document and _app as these will be
    //   // needed for most requests
    //   loadComponents({
    //     distDir: this.distDir,
    //     pathname: '/_document',
    //     hasServerComponents: false,
    //     isAppPath: false,
    //   }).catch(
    //     () => {
    //     }
    //   );
    //
    //   loadComponents(
    //     distDir: this.distDir,
    //     pathname: '/_app',
    //     hasServerComponents: false,
    //     isAppPath: false,
    //   ).catch(
    //     () => {
    //     }
    //   );
    // }

    // // expose AsyncLocalStorage on global for react usage
    // const { AsyncLocalStorage } = require('async_hooks')
    // ;(global as any).AsyncLocalStorage = AsyncLocalStorage

    // Extend `renderOpts`.
    Object.assign(this.renderOpts, options.computeJsConfig.extendRenderOpts);
  }

  // TODO: Go implement this once async_hooks is available
  // protected getRoutes() {
  //   const routes = super.getRoutes()
  //
  //   if (this.hasAppDir) {
  //     routes.handlers.set(RouteKind.APP_ROUTE, new AppRouteRouteHandler())
  //   }
  //
  //   return routes
  // }

  protected loadEnvConfig(): void {
    // NOTE: env config not loaded for Compute@Edge, here to fulfill abstract function
  }

  protected getIncrementalCache({
    requestHeaders,
  }: {
    requestHeaders: IncrementalCache['requestHeaders']
  }) {
    let CacheHandler: any
    const {incrementalCacheHandlerPath} = this.nextConfig.experimental;

    if (incrementalCacheHandlerPath) {
      CacheHandler = requireModule(join(this.distDir, incrementalCacheHandlerPath));
      CacheHandler = CacheHandler.default || CacheHandler;
    }

    // incremental-cache is request specific with a shared
    // although can have shared caches in module scope
    // per-cache handler
    return new IncrementalCache({
      dev: false,
      requestHeaders,
      appDir: this.hasAppDir,
      minimalMode: this.minimalMode,
      serverDistDir: this.serverDistDir,
      fetchCache: this.nextConfig.experimental.appDir,
      fetchCacheKeyPrefix: this.nextConfig.experimental.fetchCacheKeyPrefix,
      maxMemoryCacheSize: this.nextConfig.experimental.isrMemoryCacheSize,
      flushToDisk: false,
      getPrerenderManifest: () => {
        return this.getPrerenderManifest()
      },
      CurCacheHandler: CacheHandler,
    });
  }

  protected getResponseCache() {
    return new ComputeJsResponseCache();
  }

  protected getPublicDir(): string {
    // NOTE: Unused in minimal mode, here to fulfill abstract function
    // this fills in getPublicDir(), but this.publicDir is unused in minimal mode
    return '';
  }

  protected getHasStaticDir(): boolean {
    // NOTE: Unused in minimal mode, here to fulfill abstract function
    return false;
  }

  protected getPagesManifest(): PagesManifest | undefined {
    return requireManifest(join(this.serverDistDir, PAGES_MANIFEST));
  }

  protected getAppPathsManifest(): PagesManifest | undefined {
    if (!this.hasAppDir) { return undefined; }
    const appPathsManifestPath = join(this.serverDistDir, APP_PATHS_MANIFEST);
    return requireManifest(appPathsManifestPath);
  }

  protected getFilesystemPaths(): Set<string> {
    // NOTE: Unused in minimal mode, here to fulfill abstract function
    return new Set<string>();
  }

  protected async hasPage(pathname: string): Promise<boolean> {
    return !!getMaybePagePath(
      pathname,
      this.distDir,
      this.nextConfig.i18n?.locales,
      this.hasAppDir
    );
  }

  protected getBuildId(): string {
    return readAssetFileAsString(join(this.distDir, BUILD_ID_FILE)).trim();
  }

  protected getCustomRoutes(): CustomRoutes {
    // NOTE: Unused in minimal mode, here to fulfill abstract function
    // This all happens at the serve-vercel-build-output layer
    return {
      headers: [],
      rewrites: {
        fallback: [],
        afterFiles: [],
        beforeFiles: [],
      },
      redirects: [],
    };
  }

  protected getHasAppDir(dev: boolean): boolean {
    return Boolean(findDir(dev ? this.dir : this.serverDistDir, 'app'))
  }

  protected async sendRenderResult(
    req: NodeNextRequest,
    res: NodeNextResponse,
    options: {
      result: RenderResult;
      type: "html" | "json";
      generateEtags: boolean;
      poweredByHeader: boolean;
      options?: PayloadOptions
    }
  ): Promise<void> {
    return await sendRenderResult({
      req: req.originalRequest,
      res: res.originalResponse,
      ...options,
    });
  }

  protected handleCompression(
    req: NodeNextRequest,
    res: NodeNextResponse
  ): void {
    // Compression is handled by serve-vercel-build-output
  }

  protected async runApi(
    req: BaseNextRequest | NodeNextRequest,
    res: BaseNextResponse | NodeNextResponse,
    query: ParsedUrlQuery,
    params: Params | undefined,
    page: string,
    builtPagePath: string,
  ): Promise<boolean> {
    const pageModule = await requireModule(builtPagePath);
    query = {...query, ...params}

    delete query.__nextLocale
    delete query.__nextDefaultLocale

    await apiResolver(
      (req as NodeNextRequest).originalRequest,
      (res as NodeNextResponse).originalResponse,
      query,
      pageModule,
      {
        ...this.renderOpts.previewProps,
        revalidate: (newReq: IncomingMessage, newRes: ServerResponse) =>
          this.getRequestHandler()(
            new NodeNextRequest(newReq),
            new NodeNextResponse(newRes)
          ),
        // internal config so is not typed
        trustHostHeader: (this.nextConfig.experimental as Record<string, any>)
          .trustHostHeader,
        allowedRevalidateHeaderKeys:
          this.nextConfig.experimental.allowedRevalidateHeaderKeys,
      },
      this.minimalMode,
      this.renderOpts.dev,
      page
    );
    return true;
  }


  private normalizeReq(
    req: BaseNextRequest | IncomingMessage
  ): BaseNextRequest {
    return req instanceof BaseNextRequest ? req : new NodeNextRequest(req);
  }

  private normalizeRes(
    res: BaseNextResponse | ServerResponse
  ): BaseNextResponse {
    return res instanceof BaseNextResponse ? res : new NodeNextResponse(res);
  }

  public getRequestHandler(): NodeRequestHandler {
    const handler = super.getRequestHandler();
    return async (req, res, parsedUrl) => {
      return handler(
        this.normalizeReq(req),
        this.normalizeRes(res),
        parsedUrl
      );
    };
  }

  public getComputeJsRequestHandler(): ComputeJsRequestHandler {
    const handler = this.getRequestHandler();
    return async (request: Request) => {
      const { req, res } = toReqRes(request);
      await handler(req, res);
      return await toComputeResponse(res);
    };
  }

  public async render(
    req: BaseNextRequest | IncomingMessage,
    res: BaseNextResponse | ServerResponse,
    pathname: string,
    query?: NextParsedUrlQuery,
    parsedUrl?: NextUrlWithParsedQuery,
    internal = false
  ): Promise<void> {
    return super.render(
      this.normalizeReq(req),
      this.normalizeRes(res),
      pathname,
      query,
      parsedUrl,
      internal
    );
  }

  protected async renderHTML(
    req: NodeNextRequest,
    res: NodeNextResponse,
    pathname: string,
    query: NextParsedUrlQuery,
    renderOpts: RenderOpts
  ): Promise<RenderResult | null> {
    return getTracer().trace(NextNodeServerSpan.renderHTML, async () =>
      this.renderHTMLImpl(req, res, pathname, query, renderOpts)
    );
  }

  private async renderHTMLImpl(
    req: NodeNextRequest,
    res: NodeNextResponse,
    pathname: string,
    query: NextParsedUrlQuery,
    renderOpts: RenderOpts
  ): Promise<RenderResult | null> {

    // Due to the way we pass data by mutating `renderOpts`, we can't extend the
    // object here but only updating its `serverComponentManifest` field.
    // https://github.com/vercel/next.js/blob/df7cbd904c3bd85f399d1ce90680c0ecf92d2752/packages/next/server/render.tsx#L947-L952
    renderOpts.serverComponentManifest = this.serverComponentManifest
    renderOpts.serverCSSManifest = this.serverCSSManifest
    renderOpts.fontLoaderManifest = this.fontLoaderManifest;

    if (this.hasAppDir && renderOpts.isAppPath) {
      return appRenderToHTMLOrFlight(
        req.originalRequest,
        res.originalResponse,
        pathname,
        query,
        renderOpts
      );
    }

    return renderToHTML(
      req.originalRequest,
      res.originalResponse,
      pathname,
      query,
      renderOpts
    );
  }

  protected getPagePath(pathname: string, locales?: string[]): string {
    return getPagePath(pathname, this.distDir, locales, this.hasAppDir);
  }

    protected async findPageComponents({
    pathname,
    query,
    params,
    isAppPath,
  }: {
    pathname: string
    query: NextParsedUrlQuery
    params: Params | null
    isAppPath: boolean
  }): Promise<FindComponentsResult | null> {
    return getTracer().trace(NextNodeServerSpan.findPageComponents, () =>
      this.findPageComponentsImpl({ pathname, query, params, isAppPath })
    )
  }

  protected async findPageComponentsImpl({
    pathname,
    query,
    params,
    isAppPath,
  }: {
    pathname: string
    query: NextParsedUrlQuery
    params: Params | null
    isAppPath: boolean
  }): Promise<FindComponentsResult | null> {
    const paths: string[] = [pathname];
    if (query.amp) {
      // try serving a static AMP version first
      paths.unshift(
        (isAppPath ? normalizeAppPath(pathname) : normalizePagePath(pathname)) +
          '.amp'
      );
    }

    if (query.__nextLocale) {
      paths.unshift(
        ...paths.map(
          (path) => `/${query.__nextLocale}${path === '/' ? '' : path}`
        ));

    }

    for (const pagePath of paths) {
      try {
        const components = await loadComponents({
          distDir: this.distDir,
          pathname: pagePath,
          hasServerComponents: !!this.renderOpts.serverComponents,
          isAppPath,
        });

        if (
          query.__nextLocale &&
          typeof components.Component === 'string' &&
          !pagePath.startsWith(`/${query.__nextLocale}`)
        ) {
          // if loading a static HTML file the locale is required
          // to be present since all HTML files are output under their locale
          continue;
        }

        return {
          components,
          query: {
            ...(components.getStaticProps
              ? ({
                amp: query.amp,
                __nextDataReq: query.__nextDataReq,
                __nextLocale: query.__nextLocale,
                __nextDefaultLocale: query.__nextDefaultLocale,
              } as NextParsedUrlQuery)
              : query),
            // For appDir params is excluded.
            ...((isAppPath ? {} : params) || {}),
          },
        };
      } catch (err) {
        // we should only not throw if we failed to find the page
        // in the pages-manifest
        if (!(err instanceof PageNotFoundError)) {
          throw err;
        }
      }
    }

    return null;
  }

  protected getFontManifest(): FontManifest {
    return requireFontManifest(this.distDir);
  }

  protected getServerComponentManifest() {
    // TODO: If we want to support Server Components
    if (!this.hasAppDir) return undefined;
    return requireManifest(join(
      this.distDir,
      'server',
      CLIENT_REFERENCE_MANIFEST + '.json'
    ));
  }

  protected getServerCSSManifest() {
    // TODO: If we want to support Server Components
    if (!this.hasAppDir) return undefined;
    return requireManifest(join(
      this.distDir,
      SERVER_DIRECTORY,
      FLIGHT_SERVER_CSS_MANIFEST + '.json'
    ));
  }

  protected getFontLoaderManifest() {
    return requireManifest(join(this.distDir, 'server', `${FONT_LOADER_MANIFEST}.json`))
  }

  protected override async getFallback(page: string) {
    // Not used, as this is minimal mode.
    return '';
  }

  // NOTE: This is the same as the generateRoutes() method of WebServer,
  // because it handles things as we need in minimal mode.
  protected generateRoutes(): RouterOptions {
    const fsRoutes: Route[] = [
      {
        match: getPathMatch('/_next/data/:path*'),
        type: 'route',
        name: '_next/data catchall',
        check: true,
        fn: async (req, res, params, _parsedUrl) => {
          const isNextDataNormalizing = getRequestMeta(
            req,
            '_nextDataNormalizing'
          );

          // Make sure to 404 for /_next/data/ itself and
          // we also want to 404 if the buildId isn't correct
          if (!params.path || params.path[0] !== this.buildId) {
            if (isNextDataNormalizing) {
              return { finished: false };
            }
            await this.render404(req, res, _parsedUrl);
            return {
              finished: true,
            };
          }
          // remove buildId from URL
          params.path.shift();

          const lastParam = params.path[params.path.length - 1];

          // show 404 if it doesn't end with .json
          if (typeof lastParam !== 'string' || !lastParam.endsWith('.json')) {
            await this.render404(req, res, _parsedUrl);
            return {
              finished: true,
            };
          }

          // re-create page's pathname
          let pathname = `/${params.path.join('/')}`;
          pathname = getRouteFromAssetPath(pathname, '.json');

          // ensure trailing slash is normalized per config
          if (this.router.catchAllMiddleware[0]) {
            if (this.nextConfig.trailingSlash && !pathname.endsWith('/')) {
              pathname += '/';
            }
            if (
              !this.nextConfig.trailingSlash &&
              pathname.length > 1 &&
              pathname.endsWith('/')
            ) {
              pathname = pathname.substring(0, pathname.length - 1);
            }
          }

          if (this.nextConfig.i18n) {
            const { host } = req?.headers || {};
            // remove port from host and remove port if present
            const hostname = host?.split(':')[0].toLowerCase();
            const localePathResult = normalizeLocalePath(
              pathname,
              this.nextConfig.i18n.locales
            );
            const { defaultLocale } =
              detectDomainLocale(this.nextConfig.i18n.domains, hostname) || {};

            let detectedLocale = '';

            if (localePathResult.detectedLocale) {
              pathname = localePathResult.pathname;
              detectedLocale = localePathResult.detectedLocale;
            }

            _parsedUrl.query.__nextLocale = detectedLocale;
            _parsedUrl.query.__nextDefaultLocale =
              defaultLocale || this.nextConfig.i18n.defaultLocale;

            if (!detectedLocale && !this.router.catchAllMiddleware[0]) {
              _parsedUrl.query.__nextLocale =
                _parsedUrl.query.__nextDefaultLocale;
              await this.render404(req, res, _parsedUrl);
              return {finished: true};
            }
          }

          return {
            pathname,
            query: {..._parsedUrl.query, __nextDataReq: '1'},
            finished: false,
          };
        },
      },
      {
        match: getPathMatch('/_next/:path*'),
        type: 'route',
        name: '_next catchall',
        // This path is needed because `render()` does a check for `/_next` and the calls the routing again
        fn: async (req, res, _params, parsedUrl) => {
          await this.render404(req, res, parsedUrl);
          return {
            finished: true,
          };
        },
      },
    ];

    const catchAllRoute: Route = {
      match: getPathMatch('/:path*'),
      type: 'route',
      matchesLocale: true,
      name: 'Catchall render',
      fn: async (req, res, _params, parsedUrl) => {
        let { pathname, query } = parsedUrl;
        if (!pathname) {
          throw new Error('pathname is undefined');
        }

        // next.js core assumes page path without trailing slash
        pathname = removeTrailingSlash(pathname);

        const options: MatchOptions = {
          i18n: this.localeNormalizer?.match(pathname),
        }
        if (options.i18n?.detectedLocale) {
          parsedUrl.query.__nextLocale = options.i18n.detectedLocale
        }

        const bubbleNoFallback = !!query._nextBubbleNoFallback;
        const match = await this.matchers.match(pathname, options)

        if (match) {
          addRequestMeta(req, '_nextMatch', match)
        }

        // Try to handle the given route with the configured handlers.
        if (match) {
          let handled = false

          // If the route was detected as being a Pages API route, then handle
          // it.
          // TODO: move this behavior into a route handler.
          if (match.definition.kind === RouteKind.PAGES_API) {
            delete query._nextBubbleNoFallback

            handled = await this.handleApiRequest(
              req,
              res,
              query,
              // TODO: see if we can add a runtime check for this
              match as PagesAPIRouteMatch
            )
            if (handled) return { finished: true }
          }
        }

        try {
          await this.render(req, res, pathname, query, parsedUrl, true);

          return {
            finished: true,
          };
        } catch (err) {
          if (err instanceof NoFallbackError && bubbleNoFallback) {
            return {
              finished: false,
            };
          }
          throw err;
        }
      },
    }

    const { useFileSystemPublicRoutes } = this.nextConfig;

    if (useFileSystemPublicRoutes) {
      this.appPathRoutes = this.getAppPathRoutes();
    }

    return {
      headers: [],
      fsRoutes,
      rewrites: {
        beforeFiles: [],
        afterFiles: [],
        fallback: [],
      },
      redirects: [],
      catchAllRoute,
      catchAllMiddleware: [],
      useFileSystemPublicRoutes,
      matchers: this.matchers,
      nextConfig: this.nextConfig,
      localeNormalizer: this.localeNormalizer,
    };
  }

  /**
   * Resolves `API` request
   * @param req http request
   * @param res http response
   * @param query
   * @param match
   */
  protected async handleApiRequest(
    req: BaseNextRequest,
    res: BaseNextResponse,
    query: ParsedUrlQuery,
    match: PagesAPIRouteMatch
  ): Promise<boolean> {
    const {
      definition: { pathname, filename },
      params,
    } = match

    return this.runApi(req, res, query, params, pathname, filename);
  }

  private _cachedPreviewManifest: PrerenderManifest | undefined

  protected getPrerenderManifest(): PrerenderManifest {
    if (this._cachedPreviewManifest) {
      return this._cachedPreviewManifest
    }
    const manifestFile = join(this.distDir, PRERENDER_MANIFEST);
    const manifest = requireManifest(manifestFile);
    return (this._cachedPreviewManifest = manifest);
  }

  protected attachRequestMeta(
    req: BaseNextRequest,
    parsedUrl: NextUrlWithParsedQuery
  ) {
    // In C@E, the protocol is always https on prod and http on dev
    const hostname = fastly.env.get("FASTLY_HOSTNAME");
    const protocol = hostname !== 'localhost' ? 'https' : 'http';

    // When there are hostname and port we build an absolute URL
    const initUrl =
      this.hostname && this.port
        ? `${protocol}://${this.hostname}:${this.port}${req.url}`
        : (this.nextConfig.experimental as any).trustHostHeader
        ? `https://${req.headers.host || 'localhost'}${req.url}`
        : req.url;

    addRequestMeta(req, '__NEXT_INIT_URL', initUrl);
    addRequestMeta(req, '__NEXT_INIT_QUERY', {...parsedUrl.query});
    addRequestMeta(req, '_protocol', protocol);
    addRequestMeta(req, '__NEXT_CLONABLE_BODY', getCloneableBody(req.body));
  }

  protected get serverDistDir() {
    return join(this.distDir, SERVER_DIRECTORY)
  }
}
