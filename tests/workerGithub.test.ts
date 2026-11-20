import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  GitHubRepo,
  GitHubError,
  RefConflictError,
} from "../worker/src/github";

interface Call {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: any;
}

type Responder = (call: Call) => { status?: number; json?: unknown } | undefined;

function makeFake(responder: Responder = () => undefined) {
  const calls: Call[] = [];
  const fake = (async (input: any, init: any = {}) => {
    const call: Call = {
      method: init.method ?? "GET",
      url: String(input),
      headers: init.headers ?? {},
      body: init.body ? JSON.parse(init.body) : undefined,
    };
    calls.push(call);
    const custom = responder(call);
    if (custom) {
      return new Response(JSON.stringify(custom.json ?? {}), {
        status: custom.status ?? 200,
      });
    }
    const path = new URL(call.url).pathname;
    let json: unknown = {};
    if (path.endsWith("/git/blobs")) json = { sha: "blob-sha" };
    else if (path.includes("/git/ref/heads/")) json = { object: { sha: "head-sha" } };
    else if (path.includes("/git/commits/head-sha")) json = { tree: { sha: "base-tree" } };
    else if (path.endsWith("/git/trees")) json = { sha: "tree-sha" };
    else if (path.endsWith("/git/commits")) json = { sha: "commit-sha" };
    return new Response(JSON.stringify(json), { status: 200 });
  }) as unknown as typeof fetch;
  return { fake, calls };
}

const TOKEN = "ghp_segredo123";

function repoWith(fake: typeof fetch) {
  return new GitHubRepo({ repo: "o/r", token: TOKEN, fetch: fake });
}

describe("GitHubRepo.commitFiles", () => {
  it("cria blobs, árvore, commit e só então move a ref", async () => {
    const { fake, calls } = makeFake();
    const sha = await repoWith(fake).commitFiles(
      "feat",
      { "data/a.json": "{}", "data/b.json": null },
      "msg",
    );
    assert.equal(sha, "commit-sha");
    const writes = calls
      .filter((c) => c.method !== "GET")
      .map((c) => `${c.method} ${new URL(c.url).pathname}`);
    assert.deepEqual(writes, [
      "POST /repos/o/r/git/blobs",
      "POST /repos/o/r/git/trees",
      "POST /repos/o/r/git/commits",
      "PATCH /repos/o/r/git/refs/heads/feat",
    ]);
    const tree = calls.find((c) => c.url.endsWith("/git/trees"))!;
    assert.equal(tree.body.base_tree, "base-tree");
    assert.deepEqual(tree.body.tree, [
      { path: "data/a.json", mode: "100644", type: "blob", sha: "blob-sha" },
      { path: "data/b.json", mode: "100644", type: "blob", sha: null },
    ]);
    const patch = calls[calls.length - 1];
    assert.equal(patch.body.sha, "commit-sha");
    assert.equal(patch.body.force, false);
  });

  it("não move a ref se a criação do commit falha", async () => {
    const { fake, calls } = makeFake((c) =>
      c.method === "POST" && c.url.endsWith("/git/commits")
        ? { status: 500, json: { message: "boom" } }
        : undefined,
    );
    await assert.rejects(
      repoWith(fake).commitFiles("feat", { "data/a.json": "{}" }, "msg"),
      (e: any) =>
        e instanceof GitHubError && !(e instanceof RefConflictError) && e.status === 500,
    );
    assert.equal(calls.some((c) => c.method === "PATCH"), false);
  });

  it("PATCH 422 vira RefConflictError", async () => {
    const { fake } = makeFake((c) =>
      c.method === "PATCH"
        ? { status: 422, json: { message: "Update is not a fast forward" } }
        : undefined,
    );
    await assert.rejects(
      repoWith(fake).commitFiles("feat", { "data/a.json": "{}" }, "msg"),
      (e: any) => e instanceof RefConflictError && e.status === 422,
    );
  });
});

describe("GitHubRepo requisições", () => {
  it("envia Authorization e a mensagem de erro não vaza o token", async () => {
    const { fake, calls } = makeFake(() => ({
      status: 403,
      json: { message: "Forbidden" },
    }));
    await assert.rejects(repoWith(fake).createBranch("x", "sha"), (e: any) => {
      assert.ok(e instanceof GitHubError);
      assert.equal(e.status, 403);
      assert.match(e.message, /Forbidden/);
      assert.equal(e.message.includes(TOKEN), false);
      return true;
    });
    assert.equal(calls[0].headers["Authorization"], `Bearer ${TOKEN}`);
    assert.equal(calls[0].headers["User-Agent"], "rt-ranking-backoffice");
  });

  it("getRefSha retorna null em 404", async () => {
    const { fake } = makeFake(() => ({ status: 404, json: { message: "Not Found" } }));
    assert.equal(await repoWith(fake).getRefSha("nada"), null);
  });

  it("mergePullRequest usa squash", async () => {
    const { fake, calls } = makeFake();
    await repoWith(fake).mergePullRequest(7, "titulo", "corpo");
    const call = calls[0];
    assert.equal(call.method, "PUT");
    assert.ok(call.url.endsWith("/repos/o/r/pulls/7/merge"));
    assert.equal(call.body.merge_method, "squash");
  });
});
