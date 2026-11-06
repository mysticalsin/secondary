export function KpiTile({
  value,
  label,
  testId,
}: {
  value: string;
  label: string;
  testId?: string;
}) {
  return (
    <div className="kpi" data-testid={testId}>
      <b className="kpi-v">{value}</b>
      <span className="kpi-l">{label}</span>
    </div>
  );
}
