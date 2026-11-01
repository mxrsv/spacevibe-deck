import { useSignal } from "@preact/signals";
import { useLayoutEffect } from "preact/hooks";
import { Badge } from "../../ui/controls/badge";
import { Button } from "../../ui/controls/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../ui/controls/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../../ui/controls/dropdown-menu";
import { Input } from "../../ui/controls/input";
import { Separator } from "../../ui/controls/separator";
import { PreviewIcon } from "./preview-icon";
import { PreviewSelect, SettingsPreview } from "./preview-settings";
import { ChangesPreview, UsagePreview, WorkbenchPreview } from "./preview-surfaces";

const VIEWS = [
  { id: "workbench", label: "Workbench", icon: "workbench" },
  { id: "settings", label: "Settings", icon: "settings" },
  { id: "usage", label: "Usage", icon: "usage" },
  { id: "changes", label: "Changes", icon: "changes" },
] as const;
type View = (typeof VIEWS)[number]["id"];

const SESSIONS = [
  { title: "Refactor Settings controls", agent: "Codex", state: "Ready for review", icon: "check" },
  { title: "Review the release notes", agent: "Claude Code", state: "Working", icon: "agent" },
  { title: "Fix Explorer filtering", agent: "Codex", state: "Needs input", icon: "agent" },
] as const;

export function DeckPreview() {
  const params = new URLSearchParams(window.location.search);
  const view = useSignal<View>(
    VIEWS.find((item) => item.id === params.get("view"))?.id ?? "workbench",
  );
  const dark = useSignal(params.get("mode") !== "light");
  const selectedSession = useSignal(0);
  const open = useSignal(false);
  const task = useSignal("");
  const agent = useSignal("Codex");
  const notice = useSignal("");

  useLayoutEffect(() => {
    document.documentElement.classList.toggle("dark", dark.value);
    document.documentElement.style.colorScheme = dark.value ? "dark" : "light";
    const url = new URL(window.location.href);
    url.searchParams.set("mode", dark.value ? "dark" : "light");
    url.searchParams.set("view", view.value);
    window.history.replaceState(null, "", url);
  }, [dark.value, view.value]);

  return (
    <div className="preview-layout bg-background text-foreground">
      <header className="flex min-h-12 items-center justify-between gap-3 border-b bg-sidebar px-4">
        <div className="flex items-center gap-5">
          <div className="hidden items-center gap-1.5 sm:flex" aria-hidden="true">
            <span className="size-2.5 rounded-full bg-red-400" />
            <span className="size-2.5 rounded-full bg-amber-400" />
            <span className="size-2.5 rounded-full bg-emerald-400" />
          </div>
          <span className="text-xs font-semibold">Deck</span>
          <span className="hidden text-xs text-muted-foreground md:inline">Personal</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="hidden text-xs text-muted-foreground sm:inline">Mira · Base UI</span>
          <Button
            variant="ghost"
            size="icon"
            aria-label={dark.value ? "Switch to light mode" : "Switch to dark mode"}
            onClick={() => {
              dark.value = !dark.value;
            }}
          >
            <PreviewIcon name={dark.value ? "sun" : "moon"} />
          </Button>
          <Button
            onClick={() => {
              open.value = true;
            }}
          >
            <PreviewIcon name="add" />
            New task
          </Button>
        </div>
      </header>

      <div className="preview-workspace">
        <aside className="preview-sidebar border-r bg-sidebar text-sidebar-foreground">
          <div className="p-3">
            <Button
              variant="outline"
              className="w-full justify-start"
              onClick={() => {
                view.value = "settings";
              }}
            >
              <PreviewIcon name="search" />
              <span className="flex-1 text-left text-muted-foreground">Find a setting</span>
              <kbd className="text-[10px] text-muted-foreground">⌘,</kbd>
            </Button>
          </div>
          <div className="px-4 pt-4 pb-2 text-xs font-medium text-muted-foreground">Workspaces</div>
          <div className="px-2">
            <Button
              variant="secondary"
              className="w-full justify-start"
              onClick={() => {
                view.value = "workbench";
              }}
            >
              <PreviewIcon name="folder" />
              <span className="flex-1 text-left">spacevibe-deck</span>
              <Badge variant="outline">3</Badge>
            </Button>
            <div className="my-2 ml-4 border-l pl-2">
              <div className="flex items-center gap-2 px-2 py-2 text-xs text-muted-foreground">
                <PreviewIcon name="branch" />
                <span className="truncate">shadcn-base-ui</span>
              </div>
              <div className="space-y-1">
                {SESSIONS.map((session, index) => (
                  <div key={session.title} className="pb-2">
                    <Button
                      variant={selectedSession.value === index ? "secondary" : "ghost"}
                      aria-pressed={selectedSession.value === index}
                      className="w-full justify-start"
                      title={session.title}
                      onClick={() => {
                        selectedSession.value = index;
                        view.value = "workbench";
                        notice.value = `Selected sample session: ${session.title}`;
                      }}
                    >
                      <span className="truncate">{session.title}</span>
                    </Button>
                    <span className="mt-1 flex items-center gap-1.5 px-2 text-[11px] text-muted-foreground">
                      <PreviewIcon name={session.icon} />
                      {session.agent}
                    </span>
                  </div>
                ))}
              </div>
            </div>
            <Button
              variant="ghost"
              className="w-full justify-start"
              onClick={() => {
                notice.value = "tiny-cli is a sample workspace in this gallery.";
              }}
            >
              <PreviewIcon name="folder" />
              <span className="flex-1 text-left">tiny-cli</span>
              <span className="text-muted-foreground">1</span>
            </Button>
            <Button
              variant="ghost"
              className="w-full justify-start"
              onClick={() => {
                notice.value = "spacevibe-bench is a sample workspace in this gallery.";
              }}
            >
              <PreviewIcon name="folder" />
              <span className="flex-1 text-left">spacevibe-bench</span>
              <span className="text-muted-foreground">2</span>
            </Button>
          </div>
          <div className="mt-auto p-3">
            <Separator className="mb-3" />
            <Button
              variant={view.value === "usage" ? "secondary" : "ghost"}
              className="w-full justify-start"
              onClick={() => {
                view.value = "usage";
              }}
            >
              <PreviewIcon name="usage" />
              Usage<span className="ml-auto text-muted-foreground">$31.72</span>
            </Button>
            <Button
              variant={view.value === "settings" ? "secondary" : "ghost"}
              className="w-full justify-start"
              onClick={() => {
                view.value = "settings";
              }}
            >
              <PreviewIcon name="settings" />
              Settings
            </Button>
            <div className="mt-4 flex items-center gap-2 px-2">
              <span className="flex size-7 items-center justify-center rounded-full bg-muted text-xs font-medium">
                K
              </span>
              <div className="text-xs">
                <p>Kyan</p>
                <p className="text-muted-foreground">Personal workspace</p>
              </div>
            </div>
          </div>
        </aside>

        <main className="flex min-h-0 min-w-0 flex-col">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2">
            <nav className="flex flex-wrap gap-1" aria-label="Preview surfaces">
              {VIEWS.map((item) => (
                <Button
                  key={item.id}
                  variant={view.value === item.id ? "secondary" : "ghost"}
                  aria-current={view.value === item.id ? "page" : undefined}
                  onClick={() => {
                    view.value = item.id;
                  }}
                >
                  <PreviewIcon name={item.icon} />
                  {item.label}
                </Button>
              ))}
            </nav>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={<Button variant="ghost" size="icon" aria-label="Workspace actions" />}
              >
                <PreviewIcon name="more" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  onClick={() => {
                    open.value = true;
                  }}
                >
                  <PreviewIcon name="add" />
                  New task
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => {
                    view.value = "changes";
                  }}
                >
                  <PreviewIcon name="changes" />
                  Review changes
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => {
                    view.value = "settings";
                  }}
                >
                  <PreviewIcon name="settings" />
                  Workspace settings
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <div className="preview-content">
            {view.value === "workbench" && (
              <WorkbenchPreview
                key={SESSIONS[selectedSession.value].title}
                session={SESSIONS[selectedSession.value]}
                onChanges={() => {
                  view.value = "changes";
                }}
              />
            )}
            {view.value === "settings" && (
              <SettingsPreview
                dark={dark.value}
                onDarkChange={(value) => {
                  dark.value = value;
                }}
              />
            )}
            {view.value === "usage" && <UsagePreview />}
            {view.value === "changes" && <ChangesPreview />}
          </div>
        </main>
      </div>

      <footer className="flex min-h-8 items-center justify-between gap-3 border-t bg-sidebar px-4 text-[11px] text-muted-foreground">
        <span className="min-w-0 truncate" role="status">
          {notice.value || "Gallery preview · sample data · no live sessions"}
        </span>
        <span className="hidden shrink-0 items-center gap-1.5 sm:flex">
          <PreviewIcon name="branch" />
          shadcn-base-ui
        </span>
      </footer>

      <Dialog
        open={open.value}
        onOpenChange={(value) => {
          open.value = value;
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New task</DialogTitle>
            <DialogDescription>Try the launcher. No agent will be started.</DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              notice.value = `Preview task created for ${agent.value}: ${task.value}`;
              open.value = false;
              task.value = "";
            }}
          >
            <label className="block space-y-2 text-xs">
              <span className="font-medium">Task</span>
              <Input
                required
                autoFocus
                placeholder="What would you like to work on?"
                value={task.value}
                onInput={(event) => {
                  task.value = event.currentTarget.value;
                }}
              />
            </label>
            <div className="flex items-center justify-between gap-4">
              <span className="text-xs font-medium">Agent</span>
              <PreviewSelect
                label="Task agent"
                value={agent.value}
                options={["Codex", "Claude Code", "Gemini CLI"]}
                onChange={(value) => {
                  agent.value = value;
                }}
              />
            </div>
            <div className="flex items-center justify-between gap-4 text-xs">
              <span className="font-medium">Workspace</span>
              <span className="flex items-center gap-2 text-muted-foreground">
                <PreviewIcon name="folder" />
                spacevibe-deck
              </span>
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  open.value = false;
                }}
              >
                Cancel
              </Button>
              <Button type="submit">
                Create preview task
                <PreviewIcon name="arrow" />
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
