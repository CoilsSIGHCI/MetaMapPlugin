import { App, TFile } from "obsidian";
import type {
  GraphEdge,
  GraphSnapshot,
  NotePreview,
  SearchResponse,
} from "../types";
import { isRecord } from "../utils/guard";

export type RpcServerParams = {
  app: App;
  getGraphVersion: () => number;
};

type RpcServerLike = {
  addMethod: (
    name: string,
    method: (params: unknown, serverParams: RpcServerParams) => unknown,
  ) => void;
};

export function registerRpcMethods(server: RpcServerLike) {
  server.addMethod("graph.getSnapshot", (params, ctx) =>
    rpcGraphGetSnapshot(params, ctx),
  );
  server.addMethod("note.getPreview", (params, ctx) =>
    rpcNoteGetPreview(params, ctx),
  );
  server.addMethod("search.query", (params, ctx) =>
    rpcSearchQuery(params, ctx),
  );
}

function rpcGraphGetSnapshot(
  params: unknown,
  ctx: RpcServerParams,
): GraphSnapshot | { version: number; changed: false } {
  const p = isRecord(params) ? params : {};
  const sinceVersion = Number(p.sinceVersion ?? -1);
  const graphVersion = ctx.getGraphVersion();

  if (sinceVersion >= 0 && sinceVersion >= graphVersion) {
    return { version: graphVersion, changed: false };
  }

  // Nodes: all markdown files
  const files = ctx.app.vault.getMarkdownFiles();

  const nodes = files.map((f) => {
    const cache = ctx.app.metadataCache.getFileCache(f);
    const tags = new Set<string>();

    // Tags may appear in frontmatter and inline; cache.tags is commonly present
    if (cache?.tags) {
      for (const t of cache.tags) {
        // cache.tags entries typically like { tag: "#foo", position: ... }
        if (t.tag) tags.add(t.tag.startsWith("#") ? t.tag.slice(1) : t.tag);
      }
    }

    const title = f.basename;
    const mtime = f.stat?.mtime ?? 0;

    return { id: f.path, path: f.path, title, mtime, tags: [...tags] };
  });

  // Edges: resolvedLinks is a map of sourcePath -> { targetPath -> count }
  const resolved = (
    ctx.app.metadataCache as {
      resolvedLinks?: Record<string, Record<string, number>>;
    }
  ).resolvedLinks;
  const edges: GraphEdge[] = [];

  if (resolved) {
    for (const [source, targets] of Object.entries(resolved)) {
      for (const [target, count] of Object.entries(targets)) {
        edges.push({ source, target, count });
      }
    }
  }

  return {
    version: graphVersion,
    nodes,
    edges,
  };
}

async function rpcNoteGetPreview(
  params: unknown,
  ctx: RpcServerParams,
): Promise<NotePreview> {
  const p = isRecord(params) ? params : {};
  const path = typeof p.path === "string" ? p.path : "";
  if (!path) throw new Error("Missing params.path");

  const file = ctx.app.vault.getAbstractFileByPath(path);
  if (!(file instanceof TFile)) throw new Error(`Not a file: ${path}`);

  const cache = ctx.app.metadataCache.getFileCache(file);

  const tags = new Set<string>();
  if (cache?.tags) {
    for (const t of cache.tags) {
      if (t.tag) tags.add(t.tag.startsWith("#") ? t.tag.slice(1) : t.tag);
    }
  }

  const content = await ctx.app.vault.cachedRead(file);
  const excerpt = content.split("\n").slice(0, 30).join("\n");

  return {
    path: file.path,
    title: file.basename,
    mtime: file.stat?.mtime ?? 0,
    tags: [...tags],
    excerpt,
  };
}

async function rpcSearchQuery(
  params: unknown,
  ctx: RpcServerParams,
): Promise<SearchResponse> {
  const p = isRecord(params) ? params : {};
  const q = typeof p.q === "string" ? p.q.trim() : "";
  if (!q) throw new Error("Missing params.q");

  // Obsidian has an internal search system, but APIs vary across versions.
  // Safe prototype approach: simple substring search over markdown files (bounded).
  const limit = Math.min(Number(p.limit ?? 50), 200);

  const files = ctx.app.vault.getMarkdownFiles();
  const results: Array<{ path: string; title: string; snippet: string }> = [];

  for (const f of files) {
    if (results.length >= limit) break;

    const content = await ctx.app.vault.cachedRead(f);
    const idx = content.toLowerCase().indexOf(q.toLowerCase());
    if (idx === -1) continue;

    const start = Math.max(0, idx - 80);
    const end = Math.min(content.length, idx + q.length + 80);
    const snippet = content.slice(start, end).replace(/\s+/g, " ");

    results.push({ path: f.path, title: f.basename, snippet });
  }

  return { query: q, results };
}
