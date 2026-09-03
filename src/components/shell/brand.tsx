import { cn } from "@/lib/utils";

/** The N monogram. Purely decorative: the wordmark next to it carries the name. */
export function BrandMark({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-nox-cyan/40 bg-nox-cyan/10",
        className,
      )}
      aria-hidden="true"
    >
      <svg viewBox="0 0 24 24" className="h-4 w-4 text-nox-cyan" fill="none" stroke="currentColor" strokeWidth="2.2">
        <path d="M5 19V5l14 14V5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}

/**
 * The brand name as configured in settings. A name that starts with "NOX"
 * keeps the two-tone treatment; any other name is printed as it is.
 */
export function BrandWordmark({ name, className }: { name: string; className?: string }) {
  const trimmed = name.trim() || "NOX OS";
  const match = /^(nox)\b\s*(.*)$/i.exec(trimmed);
  if (!match) return <span className={cn("text-white", className)}>{trimmed}</span>;
  return (
    <span className={className}>
      <span className="text-nox-cyan">{match[1].toUpperCase()}</span>
      {match[2] ? <span className="text-white"> {match[2]}</span> : null}
    </span>
  );
}
