import { readFile } from "node:fs/promises";
import { join } from "node:path";

const allowed = new Set(["nodes_roles.csv", "clusters.csv", "top_nodes.csv"]);

export async function GET(_request: Request, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params;
  if (!allowed.has(file)) return new Response("Not found", { status: 404 });
  try {
    const content = await readFile(join(process.cwd(), "outputs", file));
    return new Response(new Uint8Array(content), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${file}"`,
        "Cache-Control": "no-store"
      }
    });
  } catch {
    return new Response("Export unavailable", { status: 404 });
  }
}
