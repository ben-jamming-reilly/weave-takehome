import Dashboard, { type Data } from "../src/components/dashboard";
import impact from "../src/data/impact.json";

export default function Page() {
  return <Dashboard data={impact as Data} />;
}
