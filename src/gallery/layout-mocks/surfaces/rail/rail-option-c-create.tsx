import { HugeiconsIcon } from "@hugeicons/react";
import {
  FolderAddIcon,
  GitBranchIcon,
  PlusSignIcon,
  UserAdd01Icon,
} from "@hugeicons/core-free-icons";
import { Popover } from "@base-ui/react/popover";
import { useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import { Button } from "../../../../ui/controls/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../../../../ui/controls/dropdown-menu";
import { Input } from "../../../../ui/controls/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../../../ui/controls/select";
import type { RailState } from "./rail-option-c-model";

function WorktreeForm({ state, close }: { readonly state: RailState; readonly close: () => void }) {
  const repos = state.projects.value.filter((item) => item.kind === "repository");
  const repo = useSignal(repos[0]?.id ?? "");
  const branch = useSignal("");
  const box = useRef<HTMLFormElement>(null);
  useEffect(() => {
    // The menu that opened this returns focus to its trigger as it closes; take it after.
    const timer = window.setTimeout(
      () => box.current?.querySelector<HTMLElement>("[aria-label=Branch]")?.focus(),
      160,
    );
    return () => window.clearTimeout(timer);
  }, []);
  const ready = branch.value.trim() !== "" && repo.value !== "";
  return (
    <form
      ref={box}
      className="flex flex-col gap-2"
      aria-label="New worktree"
      onSubmit={(event: Event) => {
        event.preventDefault();
        if (!ready) return;
        state.createWorktree(repo.value, branch.value.trim());
        close();
      }}
    >
      <Select
        value={repo.value}
        onValueChange={(value: string | null) => {
          if (value !== null) repo.value = value;
        }}
      >
        <SelectTrigger className="w-full" aria-label="Repository">
          <SelectValue>{state.projectOf(repo.value)?.name}</SelectValue>
        </SelectTrigger>
        <SelectContent alignItemWithTrigger={false}>
          {repos.map((item) => (
            <SelectItem key={item.id} value={item.id}>
              {item.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Input
        aria-label="Branch"
        placeholder="feat/new-branch"
        value={branch.value}
        onInput={(event: Event) => (branch.value = (event.target as HTMLInputElement).value)}
      />
      <Button type="submit" disabled={!ready}>
        Create
      </Button>
    </form>
  );
}

/** Header "+": New agent, New worktree (a popover form anchored to the row), Open folder. */
export function CreateMenu({ state }: { readonly state: RailState }) {
  const form = useSignal(false);
  const anchor = useRef<HTMLDivElement>(null);
  const target = () => {
    const selected = state.threads.value.find((item) => item.id === state.selectedId.value);
    return selected?.projectId ?? state.projects.value.find((item) => !item.hidden)?.id ?? "";
  };
  return (
    <div ref={anchor} className="relative shrink-0">
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="ghost" size="icon" aria-label="New" />}>
          <HugeiconsIcon icon={PlusSignIcon} strokeWidth={2} aria-hidden="true" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-44">
          <DropdownMenuItem onClick={() => state.addAgent(target())}>
            <HugeiconsIcon icon={UserAdd01Icon} strokeWidth={2} aria-hidden="true" />
            New agent
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => (form.value = true)}>
            <HugeiconsIcon icon={GitBranchIcon} strokeWidth={2} aria-hidden="true" />
            New worktree
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => state.openFolder()}>
            <HugeiconsIcon icon={FolderAddIcon} strokeWidth={2} aria-hidden="true" />
            Open folder
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Popover.Root open={form.value} onOpenChange={(next: boolean) => (form.value = next)}>
        <Popover.Portal>
          <Popover.Positioner
            anchor={anchor.current}
            sideOffset={6}
            align="end"
            className="isolate z-50"
          >
            <Popover.Popup className="w-64 rounded-lg bg-popover p-3 text-popover-foreground shadow-md ring-1 ring-foreground/10 outline-none">
              <WorktreeForm state={state} close={() => (form.value = false)} />
            </Popover.Popup>
          </Popover.Positioner>
        </Popover.Portal>
      </Popover.Root>
    </div>
  );
}
