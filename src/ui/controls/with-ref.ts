import { forwardRef } from "react";
import type { FunctionComponent, Ref, VNode } from "preact";

/**
 * Preact lifts `ref` off a function component's props before it runs, unless the component
 * was made with `forwardRef`. Upstream wrappers rely on React 19, where `ref` is an ordinary
 * prop that `{...props}` carries to the primitive, so under Preact the ref silently never
 * arrives, and Base UI's `render={<Wrapper />}` loses the element it positions against.
 * This wraps an upstream function body unchanged and puts the ref back into its props.
 * The ref is typed for any element, as `Button`'s always was.
 */
export function withRef<Props>(
  render: (props: Props) => VNode | null,
): FunctionComponent<Props & { ref?: Ref<HTMLElement> }> {
  return forwardRef<HTMLElement, Props>((props, ref) =>
    render(ref === null ? props : { ...props, ref }),
  ) as FunctionComponent<Props & { ref?: Ref<HTMLElement> }>;
}
