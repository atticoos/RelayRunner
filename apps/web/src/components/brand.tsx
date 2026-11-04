import { cn } from "@/lib/utils";

/** The relayrunner fork mark and wordmark, as drawn on the landing page. */
export function Brand({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2.5 text-xl font-bold tracking-[-0.01em]",
        className,
      )}
    >
      <svg
        viewBox="0 0 28 28"
        aria-hidden="true"
        className="size-[26px] fill-none stroke-go stroke-[2.4] [stroke-linecap:round]"
      >
        <path className="stroke-run" d="M11 14c4.5 0 5-7.5 10-7.5h3" />
        <path d="M4 14h7c4.5 0 5 7.5 10 7.5h3" />
      </svg>
      relayrunner
    </span>
  );
}
