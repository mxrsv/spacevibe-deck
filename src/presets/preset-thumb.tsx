import type { SerializedNode } from '../lib/split-tree';

interface PresetThumbProps {
  layout: SerializedNode;
}

function ThumbNode({ node }: { node: SerializedNode }) {
  if (node.type === 'leaf') {
    return <div class="preset-thumb__leaf" />;
  }
  return (
    <div class={`preset-thumb__split ${node.direction === 'row' ? 'is-row' : 'is-column'}`}>
      <div class="preset-thumb__branch" style={{ flex: node.ratio }}>
        <ThumbNode node={node.first} />
      </div>
      <div class="preset-thumb__branch" style={{ flex: 1 - node.ratio }}>
        <ThumbNode node={node.second} />
      </div>
    </div>
  );
}

/** Miniature of a preset's split tree for board cards. */
export function PresetThumb({ layout }: PresetThumbProps) {
  return (
    <div class="preset-thumb" aria-hidden="true">
      <ThumbNode node={layout} />
    </div>
  );
}
