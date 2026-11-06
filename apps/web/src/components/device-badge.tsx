import {
  AppWindowIcon,
  BoxIcon,
  CpuIcon,
  LaptopIcon,
  LayoutGridIcon,
  MemoryStickIcon,
  MicrochipIcon,
  MonitorIcon,
  ServerIcon,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useRef, useState, type PointerEvent, type ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { deviceName, formatMemory, type DeviceKind, type MachineDevice } from "@/lib/device";
import { timeAgo } from "@/lib/machines";

const KIND_ICONS: Record<DeviceKind, LucideIcon> = {
  laptop: LaptopIcon,
  desktop: MonitorIcon,
  server: ServerIcon,
  vm: BoxIcon,
  // A model name with no known kind, such as a Raspberry Pi.
  unknown: CpuIcon,
};

// How long the pointer can be off both the badge and the card before the card closes, so it can
// cross the gap between them.
const CLOSE_DELAY_MS = 150;

/**
 * A connected machine's device ("MacBook Pro") as a badge styled like the GitHub runner one. Its
 * specs open on hover, or on tap and keyboard where there's no hover. Nothing when the CLI
 * reported nothing it can name.
 */
export function DeviceBadge({ device }: { device: MachineDevice }) {
  const name = deviceName(device);
  const [open, setOpen] = useState(false);
  const closing = useRef<ReturnType<typeof setTimeout>>(undefined);
  const lastPointer = useRef<string>("");
  useEffect(() => () => clearTimeout(closing.current), []);
  if (!name) return null;

  const Icon = KIND_ICONS[device.kind];
  // Hover opens and closes it for a mouse. A tap or the keyboard toggles it through the trigger.
  const hover = {
    onPointerEnter: (event: PointerEvent) => {
      if (event.pointerType !== "mouse") return;
      clearTimeout(closing.current);
      setOpen(true);
    },
    onPointerLeave: (event: PointerEvent) => {
      if (event.pointerType !== "mouse") return;
      closing.current = setTimeout(() => setOpen(false), CLOSE_DELAY_MS);
    },
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`${name}: show specs`}
          className="rounded-md outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          onPointerDown={(event) => (lastPointer.current = event.pointerType)}
          onClick={(event) => {
            // A mouse already opened it by hovering; a click shouldn't close it again.
            if (lastPointer.current === "mouse") event.preventDefault();
            lastPointer.current = "";
          }}
          {...hover}
        >
          <Badge
            variant="outline"
            className="gap-1 font-normal text-muted-foreground data-[open=true]:bg-accent data-[open=true]:text-foreground"
            data-open={open}
          >
            <Icon className="size-3" aria-hidden />
            {name}
          </Badge>
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-72 p-0"
        // The card is read-only, so focus stays where it was.
        onOpenAutoFocus={(event) => event.preventDefault()}
        {...hover}
      >
        <DeviceSpecs device={device} name={name} Icon={Icon} />
      </PopoverContent>
    </Popover>
  );
}

function DeviceSpecs({
  device,
  name,
  Icon,
}: {
  device: MachineDevice;
  name: string;
  Icon: LucideIcon;
}) {
  const rows: [LucideIcon, string, ReactNode][] = [];
  if (device.chip) rows.push([MicrochipIcon, "Chip", device.chip]);
  if (device.cpuCores) rows.push([LayoutGridIcon, "Cores", device.cpuCores]);
  if (device.memoryMb) rows.push([MemoryStickIcon, "Memory", formatMemory(device.memoryMb)]);
  if (device.osVersion) rows.push([AppWindowIcon, "OS", device.osVersion]);

  return (
    <div className="flex flex-col gap-3 p-4 text-sm">
      <div className="flex items-center justify-between gap-3">
        <span className="flex min-w-0 items-center gap-2 font-medium">
          <Icon className="size-4 shrink-0" aria-hidden />
          <span className="truncate">{name}</span>
        </span>
        {device.modelId && device.modelId !== name && (
          <span className="truncate font-mono text-xs text-muted-foreground">{device.modelId}</span>
        )}
      </div>
      {rows.length > 0 && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
          {rows.map(([RowIcon, label, value]) => (
            <div key={label} className="contents">
              <dt className="flex items-center gap-2 text-muted-foreground">
                <RowIcon className="size-3.5" aria-hidden />
                {label}
              </dt>
              <dd className="min-w-0 break-words">{value}</dd>
            </div>
          ))}
        </dl>
      )}
      <p className="border-t pt-2.5 text-xs text-muted-foreground">
        Reported by relayrunner connect
        {device.reportedAt && ` · ${timeAgo(device.reportedAt)}`}
      </p>
    </div>
  );
}
