export type GraphNode = {
  id: string; // use vault path as stable id
  path: string;
  title: string;
  mtime: number;
  tags: string[];
};

export type GraphEdge = {
  source: string; // path
  target: string; // path
  count: number;
};

export type GraphSnapshot = {
  version: number;
  nodes: GraphNode[];
  edges: GraphEdge[];
};

export type NotePreview = {
  path: string;
  title: string;
  mtime: number;
  tags: string[];
  excerpt: string;
};

export type SearchResult = {
  path: string;
  title: string;
  snippet: string;
};

export type SearchResponse = {
  query: string;
  results: SearchResult[];
};

export type CreateNoteResponse = {
  path: string;
  title: string;
  mtime: number;
  created: true;
};
