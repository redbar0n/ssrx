import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';

import { serverHandler } from '~/app.tsx';
import { type ReqCtx, reqCtxMiddleware } from '~/server/middleware/context.ts';
import { trpcServer } from '~/server/middleware/trpc.ts';
import { appRouter } from '~/server/trpc/index.ts';
import { deleteCookie, setCookie } from '~/server/utils/cookies.ts';

type HonoEnv = { Variables: ReqCtx };

const server = new Hono<HonoEnv>()
  /**
   * These two serveStatic's will be used to serve production assets.
   * Vite dev server handles assets during development.
   */
  .use('/assets/*', serveStatic({ root: './dist/public' }))
  .use('/favicon.ico', serveStatic({ path: './dist/public/favicon.ico' }))

  /**
   * TRPC
   */
  .use(
    '/trpc/*',
    reqCtxMiddleware,
    trpcServer<HonoEnv>({
      router: appRouter,
      createContext: ({ c, resHeaders }) => ({
        ...c.var,
        // trpc manages it's own headers, so use those in the cookie helpers
        setCookie: (...args) => setCookie(resHeaders, ...args),
        deleteCookie: (...args) => deleteCookie(resHeaders, ...args),
      }),
    }),
  )

  /**
   * The frontend app
   */
  .get('*', reqCtxMiddleware, async c => {
    try {
      const appStream = await serverHandler({
        req: c.req.raw,
        meta: {
          // used by @super-ssr/plugin-trpc-react
          trpcCaller: appRouter.createCaller(c.var),
        },
      });

      return new Response(appStream);
    } catch (err) {
      /**
       * Handle react-router redirects
       */
      if (err instanceof Response && err.status >= 300 && err.status <= 399) {
        return c.redirect(err.headers.get('Location') || '/', err.status);
      }

      throw err;
    }
  });

/**
 * In development, vite handles starting up the server
 * In production, we need to start the server ourselves
 */
if (import.meta.env.PROD) {
  const port = Number(process.env['PORT'] || 3000);
  serve(
    {
      port,
      fetch: server.fetch,
    },
    () => {
      console.log(`🚀 Server running at http://localhost:${port}`);
    },
  );
}

export default server;
