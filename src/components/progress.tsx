export function Progress({ value, label }: { value: number; label: string }) {
  return (
    <div className="progress-wrap">
      <div className="progress-label">
        <span>{label}</span>
        <span>{value}%</span>
      </div>
      <ProgressBar
        aria-label={label}
        value={Math.min(100, Math.max(0, value))}
        className="h-1.5"
      />
    </div>
  );
}
import { Progress as ProgressBar } from "./ui/progress";
