# aspen-decorations

A virtualized list renders rows as siblings, so CSS cannot inherit from a parent row to its children.
Decorations fill that gap: target a node with a CSS class, and the class applies to the node, its
children, or both, and can be negated further down, much like CSS's `:not`.

> Work in progress: this is the 2.0 rewrite.
