import { useState } from "preact/hooks";
import { CaretRight, GearSix, Plus, Trash } from "@phosphor-icons/react";
import { DeckIcon, ROW_ICON } from "../../ui/controls/deck-icon";
import {
  Badge,
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldLabel,
  Input,
  Kbd,
  KbdGroup,
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
  Separator,
  Switch,
  Toggle,
  ToggleGroup,
  ToggleGroupItem,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../../ui/controls/preset-controls";

const VARIANTS = ["default", "secondary", "outline", "ghost", "destructive"] as const;
const SIZES = ["xs", "sm", "default", "lg"] as const;
const ICON_SIZES = ["icon-xs", "icon-sm", "icon"] as const;
const MODES = [
  { value: "system", label: "System" },
  { value: "dark", label: "Dark" },
  { value: "light", label: "Light" },
];
const SHELLS = [
  { value: "zsh", label: "zsh" },
  { value: "bash", label: "bash" },
  { value: "fish", label: "fish" },
];

export function Group({ name, children }: { name: string; children: preact.ComponentChildren }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-xs font-medium text-muted-foreground">{name}</h2>
      <div className="flex flex-wrap items-center gap-3">{children}</div>
    </section>
  );
}

export function ButtonsAndBadges() {
  return (
    <>
      <Group name="Button · variant by size">
        <div className="grid gap-2">
          {VARIANTS.map((variant) => (
            <div key={variant} className="flex items-center gap-2">
              {SIZES.map((size) => (
                <Button key={size} variant={variant} size={size}>
                  {variant}
                </Button>
              ))}
              <Button variant={variant} disabled>
                disabled
              </Button>
            </div>
          ))}
        </div>
      </Group>
      <Group name="Button · icons">
        {ICON_SIZES.map((size) => (
          <Button key={size} variant="outline" size={size} aria-label={size}>
            <DeckIcon icon={Plus} size={ROW_ICON} />
          </Button>
        ))}
        <Button>
          <DeckIcon icon={GearSix} size={ROW_ICON} data-icon="inline-start" />
          Settings
        </Button>
        <Button variant="secondary">
          Details
          <DeckIcon icon={CaretRight} size={ROW_ICON} data-icon="inline-end" />
        </Button>
        <Button variant="destructive">
          <DeckIcon icon={Trash} size={ROW_ICON} data-icon="inline-start" />
          Remove
        </Button>
      </Group>
      <Group name="Badge">
        {VARIANTS.map((variant) => (
          <Badge key={variant} variant={variant}>
            {variant}
          </Badge>
        ))}
      </Group>
    </>
  );
}

export function FieldsAndToggles() {
  const [wrap, setWrap] = useState(true);
  const [period, setPeriod] = useState(["day"]);
  return (
    <>
      <Group name="Input · Field · Label">
        <div className="grid w-72 gap-3">
          <Field>
            <FieldLabel htmlFor="gx-shell">Shell</FieldLabel>
            <Input id="gx-shell" placeholder="/bin/zsh" />
            <FieldDescription>Used for new terminals.</FieldDescription>
          </Field>
          <Field data-invalid>
            <FieldLabel htmlFor="gx-port">Port</FieldLabel>
            <Input id="gx-port" aria-invalid defaultValue="eighty" />
            <FieldError>Port must be a number</FieldError>
          </Field>
          <Field>
            <FieldLabel htmlFor="gx-off">Locked</FieldLabel>
            <Input id="gx-off" disabled defaultValue="read only" />
          </Field>
        </div>
      </Group>
      <Group name="Switch · sizes and states">
        <Field orientation="horizontal" className="w-72">
          <FieldContent>
            <FieldLabel htmlFor="gx-wrap">Wrap long lines</FieldLabel>
            <FieldDescription>Applies to new sessions.</FieldDescription>
          </FieldContent>
          <Switch id="gx-wrap" checked={wrap} onCheckedChange={setWrap} />
        </Field>
        <Switch size="sm" defaultChecked aria-label="Small on" />
        <Switch size="sm" aria-label="Small off" />
        <Switch disabled defaultChecked aria-label="Disabled on" />
        <Switch disabled aria-label="Disabled off" />
      </Group>
      <Group name="Toggle · ToggleGroup">
        <Toggle aria-label="Bold">Bold</Toggle>
        <Toggle variant="outline" defaultPressed aria-label="Italic">
          Italic
        </Toggle>
        <ToggleGroup value={period} onValueChange={setPeriod} aria-label="Usage period">
          <ToggleGroupItem value="day">Day</ToggleGroupItem>
          <ToggleGroupItem value="week">Week</ToggleGroupItem>
          <ToggleGroupItem value="month">Month</ToggleGroupItem>
        </ToggleGroup>
        <ToggleGroup variant="outline" size="sm" spacing={0} aria-label="Outline period">
          <ToggleGroupItem value="a">A</ToggleGroupItem>
          <ToggleGroupItem value="b">B</ToggleGroupItem>
        </ToggleGroup>
      </Group>
      <Group name="Kbd · Separator">
        <KbdGroup>
          <Kbd>⌘</Kbd>
          <Kbd>⇧</Kbd>
          <Kbd>A</Kbd>
        </KbdGroup>
        <div className="flex h-5 items-center gap-3">
          <span className="text-xs">Left</span>
          <Separator orientation="vertical" />
          <span className="text-xs">Right</span>
        </div>
        <Separator className="w-48" />
      </Group>
    </>
  );
}

export function Overlays() {
  const [mode, setMode] = useState("system");
  const [wrap, setWrap] = useState(false);
  const [font, setFont] = useState("mono");
  return (
    <TooltipProvider>
      <Group name="Select">
        <Select items={MODES} value={mode} onValueChange={(next) => setMode(String(next))}>
          <SelectTrigger aria-label="Mode" className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectLabel>Mode</SelectLabel>
              <SelectItem value="system">System</SelectItem>
              <SelectItem value="dark">Dark</SelectItem>
              <SelectSeparator />
              <SelectItem value="light">Light</SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>
        <Select disabled defaultValue="zsh" items={SHELLS}>
          <SelectTrigger aria-label="Disabled" className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="zsh">zsh</SelectItem>
          </SelectContent>
        </Select>
      </Group>
      <Group name="DropdownMenu">
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="outline">View</Button>} />
          <DropdownMenuContent className="w-48">
            <DropdownMenuGroup>
              <DropdownMenuLabel>Terminal</DropdownMenuLabel>
              <DropdownMenuItem>
                Split right <DropdownMenuShortcut>⌘D</DropdownMenuShortcut>
              </DropdownMenuItem>
              <DropdownMenuItem variant="destructive">Close pane</DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuCheckboxItem checked={wrap} onCheckedChange={setWrap}>
              Wrap lines
            </DropdownMenuCheckboxItem>
            <DropdownMenuRadioGroup value={font} onValueChange={(next) => setFont(String(next))}>
              <DropdownMenuRadioItem value="mono">Mono</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="sans">Sans</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>More</DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuItem>Reload</DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          </DropdownMenuContent>
        </DropdownMenu>
      </Group>
      <Group name="Popover · Tooltip · Dialog">
        <Popover>
          <PopoverTrigger render={<Button variant="outline">Branches</Button>} />
          <PopoverContent>
            <PopoverHeader>
              <PopoverTitle>Checkout</PopoverTitle>
              <PopoverDescription>Switch to another branch of this project.</PopoverDescription>
            </PopoverHeader>
          </PopoverContent>
        </Popover>
        <Tooltip>
          <TooltipTrigger render={<Button variant="outline" size="icon" aria-label="Settings" />}>
            <DeckIcon icon={GearSix} size={ROW_ICON} />
          </TooltipTrigger>
          <TooltipContent>
            Settings{" "}
            <KbdGroup>
              <Kbd>⌘</Kbd>
              <Kbd>,</Kbd>
            </KbdGroup>
          </TooltipContent>
        </Tooltip>
        <Dialog>
          <DialogTrigger render={<Button>Rename</Button>} />
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Rename workspace</DialogTitle>
              <DialogDescription>Pick a name for this workspace.</DialogDescription>
            </DialogHeader>
            <Input aria-label="Name" defaultValue="spacevibe-deck" />
            <DialogFooter>
              <DialogClose render={<Button variant="outline">Cancel</Button>} />
              <Button>Save</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </Group>
    </TooltipProvider>
  );
}
