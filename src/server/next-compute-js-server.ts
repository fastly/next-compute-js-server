/*
 * Copyright Fastly, Inc.
 * Licensed under the MIT license. See LICENSE file for details.
 *
 * Portions of this file Copyright Vercel, Inc., licensed under the MIT license. See LICENSE file for details.
 */

import { join } from 'path';
import { env } from "fastly:env";

import {
  APP_PATHS_MANIFEST,
  BUILD_ID_FILE,
  FLIGHT_MANIFEST,
  FLIGHT_SERVER_CSS_MANIFEST,
  PAGES_MANIFEST,
  PRERENDER_MANIFEST,
  SERVER_DIRECTORY,
} from 'next/constants';

import { PrerenderManifest } from 'next/dist/build';
import { PagesManifest } from 'next/dist/build/webpack/plugins/pages-manifest-plugin';
import isError from 'next/dist/lib/is-error';
import { CustomRoutes } from 'next/dist/lib/load-custom-routes';
import { COOKIE_NAME_PRERENDER_BYPASS, COOKIE_NAME_PRERENDER_DATA } from 'next/dist/server/api-utils';
import { apiResolver } from 'next/dist/server/api-utils/node';
import { BaseNextRequest, BaseNextResponse } from 'next/dist/server/base-http';
import BaseServer, {
  FindComponentsResult,
  NoFallbackError,
  Options,
} from 'next/dist/server/base-server';
import { getClonableBody } from 'next/dist/server/body-streams';
import { FontManifest} from 'next/dist/server/font-utils';
import { RenderOpts, renderToHTML } from 'next/dist/server/render';
import { renderToHTMLOrFlight as appRenderToHTMLOrFlight } from 'next/dist/server/app-render';
import { addRequestMeta, NextParsedUrlQuery, NextUrlWithParsedQuery } from 'next/dist/server/request-meta';
import { DynamicRoutes, PageChecker, Route } from 'next/dist/server/router';
import { PayloadOptions, sendRenderResult } from 'next/dist/server/send-payload';
import { detectDomainLocale } from 'next/dist/shared/lib/i18n/detect-domain-locale';
import { normalizeLocalePath } from 'next/dist/shared/lib/i18n/normalize-locale-path';
import { normalizePagePath } from 'next/dist/shared/lib/page-path/normalize-page-path';
import { isDynamicRoute } from 'next/dist/shared/lib/router/utils';
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
  readAssetFileAsString,
} from './require';
import { loadComponents } from './load-components';
import ComputeJsResponseCache from './response-cache/compute-js';

import type { IncomingMessage, ServerResponse } from 'http';
import type { ParsedUrlQuery } from 'querystring';
import type { NextConfig } from 'next';
import type RenderResult from 'next/dist/server/render-result';
import type { NodeRequestHandler } from "next/dist/server/next-server";

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

    /**
     * This sets environment variable to be used at the time of SSR by head.tsx.
     * Using this from process.env allows targeting both serverless and SSR by calling
     * `process.env.__NEXT_OPTIMIZE_CSS`.
     */
    // if (this.renderOpts.optimizeFonts) {
    //   process.env.__NEXT_OPTIMIZE_FONTS = JSON.stringify(true);
    // }
    // if (this.renderOpts.optimizeCss) {
    //   process.env.__NEXT_OPTIMIZE_CSS = JSON.stringify(true);
    // }
    // if (this.renderOpts.nextScriptWorkers) {
    //   process.env.__NEXT_SCRIPT_WORKERS = JSON.stringify(true);
    // }

    // if (!options.dev) {
    //   // We are always in prod mode, so we should always be in here
    //
    //   // pre-warm _document and _app as these will be
    //   // needed for most requests
    //   loadComponents(
    //     this.distDir,
    //     '/_document',
    //     false,
    //     false,
    //     false,
    //   ).catch(
    //     () => {
    //     }
    //   );
    //
    //   loadComponents(
    //     this.distDir,
    //     '/_app',
    //     false,
    //     false,
    //     false,
    //   ).catch(
    //     () => {
    //     }
    //   );
    // }

    // Extend `renderOpts`.
    Object.assign(this.renderOpts, options.computeJsConfig.extendRenderOpts);
  }

  protected loadEnvConfig(): void {
    // NOTE: env config not loaded for Compute@Edge, here to fulfill abstract function
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
    const pagesManifestFile = join(
      this.distDir,
      SERVER_DIRECTORY,
      PAGES_MANIFEST,
    );
    return requireManifest(pagesManifestFile);
  }

  protected getAppPathsManifest(): PagesManifest | undefined {
    if (this.nextConfig.experimental.appDir) {
      const appPathsManifestPath = join(
        this.distDir,
        SERVER_DIRECTORY,
        APP_PATHS_MANIFEST,
      );
      return requireManifest(appPathsManifestPath);
    }
    return undefined;
  }

  protected getFilesystemPaths(): Set<string> {
    // NOTE: Unused in minimal mode, here to fulfill abstract function
    return new Set<string>();
  }

  protected async hasPage(pathname: string): Promise<boolean> {
    let found = false;
    try {
      found = !!this.getPagePath(pathname, this.nextConfig.i18n?.locales);
    } catch (_) {}

    return found;
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

    const originalResponse = (res as NodeNextResponse).originalResponse;

    // The ISR-related bypass and preview data cookies will set "Secure" and "SameSite=None".
    // When running localhost, patch Set-Cookie to remove these cookie attributes so that
    // the cookies are usable in non-https.
    if (env("FASTLY_HOSTNAME") === 'localhost' && !(originalResponse as any)._fastlySetHeaderPatched) {
      (originalResponse as any)._fastlySetHeaderPatched = true;

      const origSetHeader = originalResponse.setHeader;
      originalResponse.setHeader = (name: string, val: string | string[]) => {
        if (name.toLowerCase() !== 'set-cookie') {
          return origSetHeader.call(originalResponse, name, val);
        }

        const replaced = (Array.isArray(val) ? val : [ val ])
          .map(v => {
            // only modify these two cookies
            if (
              !v.startsWith(COOKIE_NAME_PRERENDER_BYPASS + '=') &&
              !v.startsWith(COOKIE_NAME_PRERENDER_DATA + '=')
            ) {
              return v;
            }

            return v.split(';')
              .map(x => {
                if (x.trim().toLowerCase() === 'secure') {
                  return null;
                }
                if (x.trim().toLowerCase() === 'samesite=none') {
                  return ' SameSite=Lax';
                }
                return x;
              })
              .filter(x => x != null)
              .join(';');
          });

        return origSetHeader.call(originalResponse, name, replaced);
      };
    }

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
        trustHostHeader: (this.nextConfig.experimental as any).trustHostHeader,
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

    // Due to the way we pass data by mutating `renderOpts`, we can't extend the
    // object here but only updating its `serverComponentManifest` field.
    // https://github.com/vercel/next.js/blob/df7cbd904c3bd85f399d1ce90680c0ecf92d2752/packages/next/server/render.tsx#L947-L952
    renderOpts.serverComponentManifest = this.serverComponentManifest
    renderOpts.serverCSSManifest = this.serverCSSManifest

    if (
      this.nextConfig.experimental.appDir &&
      (renderOpts.isAppPath || query.__flight__)
    ) {
      const isPagesDir = !renderOpts.isAppPath
      return appRenderToHTMLOrFlight(
        req.originalRequest,
        res.originalResponse,
        pathname,
        query,
        renderOpts,
        isPagesDir
      )
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
    return getPagePath(
      pathname,
      this.distDir,
      false,
      this.renderOpts.dev,
      locales,
      this.nextConfig.experimental.appDir
    );
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
    let paths = [
      // try serving a static AMP version first
      query.amp ?
        (isAppPath ?
          normalizeAppPath(pathname) :
          normalizePagePath(pathname)
        ) + '.amp' : null,
      pathname,
    ].filter(Boolean);

    if (query.__nextLocale) {
      paths = [
        ...paths.map(
          (path) => `/${query.__nextLocale}${path === '/' ? '' : path}`
        ),
        ...paths,
      ];
    }

    for (const pagePath of paths) {
      try {
        const components = await loadComponents(
          this.distDir,
          pagePath!,
          false,
          !!this.renderOpts.serverComponents,
          isAppPath,
        );

        if (
          query.__nextLocale &&
          typeof components.Component === 'string' &&
          !pagePath?.startsWith(`/${query.__nextLocale}`)
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
                __flight__: query.__flight__,
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
    return requireFontManifest(this.distDir, false);
  }

  protected getServerComponentManifest() {
    // TODO: If we want to support Server Components
    if (!this.nextConfig.experimental.serverComponents) return undefined;
    return requireManifest(join(this.distDir, SERVER_DIRECTORY, FLIGHT_MANIFEST + '.json'));
  }

  protected getServerCSSManifest() {
    // TODO: If we want to support Server Components
    if (!this.nextConfig.experimental.serverComponents) return undefined;
    return requireManifest(join(
      this.distDir,
      SERVER_DIRECTORY,
      FLIGHT_SERVER_CSS_MANIFEST + '.json'
    ));
  }

  protected override async getFallback(page: string) {
    // Not used, as this is minimal mode.
    return '';
  }

  // NOTE: This is the same as the generateRoutes() method of WebServer,
  // because it handles things as we need in minimal mode.
  protected generateRoutes(): {
    headers: Route[]
    rewrites: {
      beforeFiles: Route[]
      afterFiles: Route[]
      fallback: Route[]
    }
    fsRoutes: Route[]
    redirects: Route[]
    catchAllRoute: Route
    catchAllMiddleware: Route[]
    pageChecker: PageChecker
    useFileSystemPublicRoutes: boolean
    dynamicRoutes: DynamicRoutes | undefined
    nextConfig: NextConfig
  } {
    const fsRoutes: Route[] = [
      {
        match: getPathMatch('/_next/data/:path*'),
        type: 'route',
        name: '_next/data catchall',
        check: true,
        fn: async (req, res, params, _parsedUrl) => {
          // Make sure to 404 for /_next/data/ itself and
          // we also want to 404 if the buildId isn't correct
          if (!params.path || params.path[0] !== this.buildId) {
            await this.render404(req, res, _parsedUrl)
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

        if (this.nextConfig.i18n) {
          const localePathResult = normalizeLocalePath(
            pathname,
            this.nextConfig.i18n?.locales
          );

          if (localePathResult.detectedLocale) {
            pathname = localePathResult.pathname;
            parsedUrl.query.__nextLocale = localePathResult.detectedLocale;
          }
        }
        const bubbleNoFallback = !!query._nextBubbleNoFallback;

        if (pathname === '/api' || pathname.startsWith('/api/')) {
          delete query._nextBubbleNoFallback;

          // NOTE (Fastly): Unlike the WebServer implementation from
          // "next", we have to handle this API request here.
          const handled = await this.handleApiRequest(req, res, pathname, query);
          if (handled) {
            return {finished: true};
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
      this.dynamicRoutes = this.getDynamicRoutes();
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
      dynamicRoutes: this.dynamicRoutes,
      pageChecker: this.hasPage.bind(this),
      nextConfig: this.nextConfig,
    };
  }

  /**
   * Resolves `API` request
   * @param req http request
   * @param res http response
   * @param pathname path of request
   * @param query
   */
  protected async handleApiRequest(
    req: BaseNextRequest,
    res: BaseNextResponse,
    pathname: string,
    query: ParsedUrlQuery
  ): Promise<boolean> {
    let page = pathname;
    let params: Params | undefined = undefined;
    let pageFound = !isDynamicRoute(page) && (await this.hasPage(page));

    if (!pageFound && this.dynamicRoutes) {
      for (const dynamicRoute of this.dynamicRoutes) {
        params = dynamicRoute.match(pathname) || undefined;
        if (dynamicRoute.page.startsWith('/api') && params) {
          page = dynamicRoute.page;
          pageFound = true;
          break;
        }
      }
    }

    if (!pageFound) {
      return false;
    }

    let builtPagePath
    try {
      builtPagePath = this.getPagePath(page);
    } catch (err) {
      if (isError(err) && err.code === 'ENOENT') {
        return false;
      }
      throw err
    }

    return this.runApi(req, res, query, params, page, builtPagePath);
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
    const hostname = env("FASTLY_HOSTNAME");
    const protocol = hostname !== 'localhost' ? 'https' : 'http';

    // When there are hostname and port we build an absolute URL
    const initUrl =
      this.hostname && this.port
        ? `${protocol}://${this.hostname}:${this.port}${req.url}`
        : req.url;

    addRequestMeta(req, '__NEXT_INIT_URL', initUrl);
    addRequestMeta(req, '__NEXT_INIT_QUERY', {...parsedUrl.query});
    addRequestMeta(req, '_protocol', protocol);
    addRequestMeta(req, '__NEXT_CLONABLE_BODY', getClonableBody(req.body));
  }
}
