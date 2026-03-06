# aspen-tree-state

Remembers which branches of a tree are expanded and where it is scrolled to, so an app can put the
tree back the way the user left it. It is a plain consumer of the public API of `aspen-core` and
`aspen-tree-model`, nothing here is privileged.

```ts
const state = new TreeState(model)
localStorage.setItem('tree', state.toString())

// next time, before handing the model to the view
await state.load(localStorage.getItem('tree'))
```

> Work in progress: this is the 2.0 rewrite.
