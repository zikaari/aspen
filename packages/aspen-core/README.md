# aspen-core

The kernel of Aspen: a lazily loaded tree of `Branch` and `Leaf` nodes whose visible rows are kept in
a flat `Uint32Array`, so a windowed list can read row `n` in O(1).

> Work in progress: this is the 2.0 rewrite.
