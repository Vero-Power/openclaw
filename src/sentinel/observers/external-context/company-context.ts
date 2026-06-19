export interface CompanyContextFirestoreLike {
  countProjectsByField(field: "state" | "status" | "workflowName"): Promise<Record<string, number>>;
  sumProjectValue(filter: { status?: string }): Promise<number>;
  countWorkOrdersByStatus(): Promise<Record<string, number>>;
}

export interface CompanyContextDeps {
  client: CompanyContextFirestoreLike;
}

function formatCounts(counts: Record<string, number>, separator: string): string {
  return Object.entries(counts)
    .toSorted((a, b) => b[1] - a[1])
    .map(([key, count]) => `${key} (${count})`)
    .join(separator);
}

function formatStates(states: Record<string, number>, total: number): string {
  return Object.entries(states)
    .toSorted((a, b) => b[1] - a[1])
    .map(([state, count]) => {
      const pct = total > 0 ? ` ${((count / total) * 100).toFixed(1)}%` : "";
      return `${state} (${count}${pct})`;
    })
    .join(", ");
}

export async function buildCompanyContext(deps: CompanyContextDeps): Promise<string> {
  const [states, statuses, workflows, activeValue, woStatuses] = await Promise.all([
    deps.client.countProjectsByField("state"),
    deps.client.countProjectsByField("status"),
    deps.client.countProjectsByField("workflowName"),
    deps.client.sumProjectValue({ status: "ACTIVE" }),
    deps.client.countWorkOrdersByStatus(),
  ]);

  const statusTotal = Object.values(statuses).reduce((a, b) => a + b, 0);
  const stateTotal = Object.values(states).reduce((a, b) => a + b, 0);
  const totalProjects = Math.max(statusTotal, stateTotal);

  if (totalProjects === 0) {
    return "COMPANY SNAPSHOT (live data from Firestore): No project data available.";
  }

  const activeCount = statuses.ACTIVE ?? 0;
  const formattedValue = `$${Math.round(activeValue).toLocaleString("en-US")}`;
  const geographyLine = formatStates(states, totalProjects);
  const statusLine = formatCounts(statuses, ", ");
  const workflowLine = formatCounts(workflows, ", ");
  const woAssigned = woStatuses.assigned ?? 0;
  const woWaiting = woStatuses.waiting ?? 0;
  const woReview = woStatuses.review ?? 0;
  const woCompleted = woStatuses.completed ?? 0;

  return [
    "COMPANY SNAPSHOT (live data from Firestore):",
    `Vero is a residential solar installer with ${totalProjects} projects in Coperniq.`,
    `Geography: ${geographyLine}.`,
    `Active pipeline: ${activeCount} projects, ${formattedValue} total value.`,
    `Status mix: ${statusLine}.`,
    `Workflows: ${workflowLine}.`,
    `Work orders: ${woCompleted} completed lifetime, ${woAssigned} currently assigned, ${woWaiting} waiting, ${woReview} in review.`,
  ].join("\n");
}
