import Shell from "@/components/Shell";
import InvestigationTables from "@/components/InvestigationTables";
import { getGraphData } from "@/lib/data";

export default async function PrioritiesPage() {
  return <Shell><InvestigationTables data={await getGraphData()} section="priorities"/></Shell>;
}
