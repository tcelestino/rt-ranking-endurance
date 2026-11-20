import { createApp } from './app';
import { analyzeImage } from './analyzer';
import { clerkVerifier, getUserSummary } from './auth';
import type { Env } from './env';
import { GitHubRepo } from './github';
import { kvImageCache } from './kvImageCache';
import { cacheApiBlobCache, loadSnapshot } from './snapshot';
import { WorkingCopy } from './workingCopy';

// Sem estado em nível de módulo: as dependências reais são montadas a cada requisição a partir do env.
const app = createApp<Env>({
  verify: (env) => clerkVerifier(env),
  workingCopy: (env) => {
    const repo = new GitHubRepo({ repo: env.GITHUB_REPO, token: env.GITHUB_TOKEN });
    return new WorkingCopy({
      repo,
      loadSnapshot: (ref) => loadSnapshot(repo, ref, cacheApiBlobCache(caches.default)),
      now: () => new Date(),
    });
  },
  imageCache: (env) => kvImageCache(env.IMAGE_CACHE),
  analyze: (env, bytes, mimeType) => analyzeImage(env.AI, bytes, mimeType, env.CLOUDFLARE_AI_MODEL),
  userSummary: (env, userId) => getUserSummary(env, userId),
  now: () => new Date(),
});

export default {
  fetch(req: Request, env: Env, ctx: ExecutionContext): Response | Promise<Response> {
    return app.fetch(req, env, ctx);
  },
} satisfies ExportedHandler<Env>;
