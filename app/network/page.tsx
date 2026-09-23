import Shell from "@/components/Shell";
import NetworkExplorer from "@/components/NetworkExplorer";
import { getGraphData } from "@/lib/data";

export default async function NetworkPage({ searchParams }: { searchParams: Promise<{ gid?: string; cluster?: string }> }) {
  const [data, params] = await Promise.all([getGraphData(), searchParams]);
  return <Shell><NetworkExplorer data={data} initialGid={params.gid} initialCluster={params.cluster}/></Shell>;
}
