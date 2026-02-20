import { App, TFile, TFolder, normalizePath } from "obsidian";
import type {
  CreateNoteResponse,
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
  // Keep both names for compatibility with current and future clients.
  server.addMethod("note.create", (params, ctx) => rpcNoteCreate(params, ctx));
  server.addMethod("createNote", (params, ctx) => rpcNoteCreate(params, ctx));
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

async function rpcNoteCreate(
  params: unknown,
  ctx: RpcServerParams,
): Promise<CreateNoteResponse> {
  const p = isRecord(params) ? params : {};
  const rawPath = typeof p.path === "string" ? p.path.trim() : "";
  const heading = typeof p.heading === "string" ? p.heading.trim() : "";
  const body = typeof p.body === "string" ? p.body : "";

  if (!rawPath) throw new Error("Missing params.path");
  if (!heading) throw new Error("Missing params.heading");

  const path = normalizePath(rawPath);
  if (!path.toLowerCase().endsWith(".md")) {
    throw new Error("params.path must end with .md");
  }

  const existing = ctx.app.vault.getAbstractFileByPath(path);
  if (existing instanceof TFile) {
    throw new Error(`File already exists: ${path}`);
  }
  if (existing && !(existing instanceof TFolder)) {
    throw new Error(`Path already exists and is not a markdown file: ${path}`);
  }

  const folderPath = path.split("/").slice(0, -1).join("/");
  if (folderPath) {
    await ensureFolderPath(ctx.app, folderPath);
  }

  const content = `# ${heading}\n\n${body.trimEnd()}\n`;
  const file = await ctx.app.vault.create(path, content);

  return {
    path: file.path,
    title: file.basename,
    mtime: file.stat?.mtime ?? 0,
    created: true,
  };
}

async function ensureFolderPath(app: App, folderPath: string): Promise<void> {
  const segments = folderPath.split("/").filter(Boolean);
  let current = "";

  for (const segment of segments) {
    current = current ? `${current}/${segment}` : segment;
    const existing = app.vault.getAbstractFileByPath(current);

    if (!existing) {
      await app.vault.createFolder(current);
      continue;
    }

    if (!(existing instanceof TFolder)) {
      throw new Error(`Path segment is not a folder: ${current}`);
    }
  }
}
