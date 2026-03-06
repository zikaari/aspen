# react-aspen

A React view for Aspen trees. The rows live in a `Uint32Array`, so a windowed list can ask for row
`n` in O(1) however large or deeply nested the tree is, and expanding or collapsing a branch splices
that array instead of walking the tree. You decide **what** a row looks like, Aspen takes care of the rest.

```tsx
<Tree model={model} width={400} height={600} itemHeight={24} onReady={(handle) => { /* ... */ }}>
  {({ item, itemType }) => <Row item={item} itemType={itemType} />}
</Tree>
```

Needs `aspen-core` and `aspen-tree-model`, and `react` 18 or newer.

> Work in progress: this is the 2.0 rewrite.
