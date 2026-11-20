export interface Env {
  ASSETS: Fetcher;
  AI: Ai;
  IMAGE_CACHE: KVNamespace;
  RATE_LIMITER: RateLimit;
  CLERK_SECRET_KEY: string;
  CLERK_PUBLISHABLE_KEY: string;
  GITHUB_TOKEN: string;
  GITHUB_REPO: string; // "owner/repo"
  ALLOWED_ORIGIN: string;
  CURRENT_MONTH?: string;
  CLOUDFLARE_AI_MODEL?: string;
}
