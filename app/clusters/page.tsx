import Shell from "@/components/Shell";
import InvestigationTables from "@/components/InvestigationTables";
import { getGraphData } from "@/lib/data";

export default async function ClustersPage() {
  return <Shell><InvestigationTables data={await getGraphData()} section="clusters"/></Shell>;
}
