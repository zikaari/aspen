# aspen-tree-model

`TreeModel` is the view-model that a tree view binds to. It owns the `Root`, remembers the scroll
offset, and keeps a stash of expansion changes so a branch can be peeked at and then closed again.

Subclass it to attach add-ons, such as `aspen-decorations`.

> Work in progress: this is the 2.0 rewrite.
