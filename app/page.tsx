import Shell from "@/components/Shell";
import Dashboard from "@/components/Dashboard";
import { getGraphData } from "@/lib/data";

export default async function HomePage() {
  const data = await getGraphData();
  return <Shell><Dashboard data={data}/></Shell>;
}
