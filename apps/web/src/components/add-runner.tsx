import { useState, type ReactNode } from "react";
import {
  CheckIcon,
  ChevronDownIcon,
  CopyIcon,
  LaptopIcon,
  PlusIcon,
  ServerIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const CONNECT_COMMAND = "npx relayrunner connect";

/** "Add runner" menu on the Runners page: a local machine now, remote machines later. */
export function AddRunner() {
  const [localOpen, setLocalOpen] = useState(false);
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="sm">
            <PlusIcon />
            Add runner
            <ChevronDownIcon />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuItem onSelect={() => setLocalOpen(true)}>
            <LaptopIcon />
            Local machine
          </DropdownMenuItem>
          <DropdownMenuItem disabled>
            <ServerIcon />
            Remote machine
            <Badge variant="idle" className="ml-auto px-1.5 text-[10px] tracking-wider">
              SOON
            </Badge>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <LocalMachineDialog open={localOpen} onOpenChange={setLocalOpen} />
    </>
  );
}

function LocalMachineDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Connect a local machine</DialogTitle>
          <DialogDescription>
            Run your workspace's private jobs on a laptop or server instead of spending GitHub
            minutes.
          </DialogDescription>
        </DialogHeader>
        <ol className="grid gap-4 text-sm">
          <Step n={1} title="Run the CLI on the machine">
            <p className="text-muted-foreground">Needs Node.js 22 or later.</p>
            <CopyCommand command={CONNECT_COMMAND} />
          </Step>
          <Step n={2} title="Approve it in your browser">
            <p className="text-muted-foreground">
              The CLI shows a code and opens this dashboard. Check the code matches, pick the
              workspace and a name for the machine, then approve.
            </p>
          </Step>
          <Step n={3} title="Keep it running">
            <p className="text-muted-foreground">
              The machine shows up on this page as online and picks up jobs one at a time. Press
              Ctrl-C to take it offline. Later runs reuse the saved sign-in.
            </p>
          </Step>
        </ol>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <li className="grid grid-cols-[1.5rem_1fr] gap-x-3 gap-y-1.5">
      <span className="flex size-6 items-center justify-center rounded-full border font-mono text-xs text-muted-foreground">
        {n}
      </span>
      <span className="self-center font-medium">{title}</span>
      <div className="col-start-2 grid gap-2">{children}</div>
    </li>
  );
}

function CopyCommand({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard can be blocked (insecure origin, permissions); the command is still selectable.
    }
  }
  return (
    <div className="flex items-center justify-between gap-2 rounded-md border bg-muted/50 py-1 pr-1 pl-3">
      <code className="overflow-x-auto font-mono text-sm whitespace-nowrap">
        <span className="text-muted-foreground select-none">$ </span>
        {command}
      </code>
      <Button
        size="icon-sm"
        variant="ghost"
        aria-label={copied ? "Copied" : "Copy command"}
        onClick={() => void copy()}
      >
        {copied ? <CheckIcon /> : <CopyIcon />}
      </Button>
    </div>
  );
}
