import { Collapsible as CollapsiblePrimitive } from "@base-ui/react/collapsible";
import { withRef } from "./with-ref";

const Collapsible = withRef(function Collapsible({
  ...props
}: Omit<CollapsiblePrimitive.Root.Props, "ref">) {
  return <CollapsiblePrimitive.Root data-slot="collapsible" {...props} />;
});

const CollapsibleTrigger = withRef(function CollapsibleTrigger({
  ...props
}: Omit<CollapsiblePrimitive.Trigger.Props, "ref">) {
  return <CollapsiblePrimitive.Trigger data-slot="collapsible-trigger" {...props} />;
});

const CollapsibleContent = withRef(function CollapsibleContent({
  ...props
}: Omit<CollapsiblePrimitive.Panel.Props, "ref">) {
  return <CollapsiblePrimitive.Panel data-slot="collapsible-content" {...props} />;
});

export { Collapsible, CollapsibleTrigger, CollapsibleContent };
