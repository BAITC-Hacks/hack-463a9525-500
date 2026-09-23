import { readFile } from "node:fs/promises";
import { join } from "node:path";

export type Role = "coordinator" | "consolidator" | "distributor" | "transit" | "terminal" | "peripheral";

export type GraphNode = {
  gid: string;
  depth: number;
  is_seed: boolean;
  role: Role;
  role_score: number;
  cluster_id: number;
  priority_score: number;
  evidence: string;
  in_deg: number;
  out_deg: number;
  in_kzt: number;
  out_kzt: number;
  in_tx: number;
  out_tx: number;
  seed_reach: number;
  rapid_share: number;
  pass_through: number | null;
  truncated_by_depth: boolean;
};

export type GraphEdge = { src: string; dst: string; sum_kzt: number; n_tx: number };
export type Cluster = { cluster_id: number; n_nodes: number; n_seed: number; sum_kzt_internal: number; top_gids: string; hypothesis: string };
export type GraphData = {
  summary: { nodes: number; edges: number; transactions: number; seeds: number; turnover_kzt: number; clusters: number; period_start: string; period_end: string; role_counts: Record<Role, number> };
  nodes: GraphNode[];
  edges: GraphEdge[];
  clusters: Cluster[];
  daily: { date: string; amount: number; count: number }[];
};

export async function getGraphData(): Promise<GraphData> {
  const content = await readFile(join(process.cwd(), "out", "dashboard.json"), "utf8");
  return JSON.parse(content) as GraphData;
}
