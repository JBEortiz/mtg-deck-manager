import type { ReactNode } from "react";

type StatCardProps = {
  label: string;
  value: ReactNode;
};

export default function StatCard({ label, value }: StatCardProps) {
  return (
    <div className="stat-card">
      <span className="stat-label">{label}</span>
      <strong className="stat-value">{value}</strong>
    </div>
  );
}
