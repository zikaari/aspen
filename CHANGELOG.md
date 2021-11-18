## 2.0.0

The Aspen ecosystem has been re-written from the ground up to be a generic tree library instead of being constrained to just file systems.
The remarkable performance and features continue to be a top priority and no compromises have been made when it comes to raw power it possesses.

### Breaking changes

#### aspen-core

- The `Root` class has been refactored to a simpler generic class called `Tree`.
- The `Directory` class has been refactored to a simpler generic class called `Branch`.
- The `FileEntry` class has been refactored to a simpler generic class called `Leaf`.
- `FileType` enum has been replaced with `Tree.isLeaf(node)` and `Tree.isBranch(node)`.
- `BasicFileSystemHost` has been removed in favor of a generic and more performant `TreeSource` provider. Where you'd previously implement
a `getItems` method that would return an array of file entry descriptors, there is now `getNodes` instead. The `getNodes` method will be called
with a literal `Branch` and you'll return an array of `TreeNode`s for it. No more "descriptor" objects, instead the actual `Branch`s and `Leaf`s
using very simple factory functions to create either of those.
- The concept "file paths" is now a thing of the past. The entire tree is now agnostic of any such concept, although you can continue to use the
`data` property available on `Leaf`s and `Branch`s, which you can read/write to at will anytime you wish.
- Built-in sorting has been removed. Sorting of tree items must be done manually *before* returning the nodes array from within `getNodes` method. If
any sorting needs to be done at a later time, read the documentation for `Tree#amend`.
- Almost all operations like `expand`, `collpase` etc. are now executed through the `Tree` instance instead of them being methods of the node itself.
Where you could previously call `Directory#expand(...options)`, now there's just `Tree#expand(branch, ...options)`.
- There is no equivalent of `Root.iterateTopDown` in the refactored `Tree` class due to various complexities around it. One of them being
that a tree structure *can* change while the iterator is running. This means iterator might even be iterating over nodes that no longer exist.
It's best to free `aspen-core` of this liability as people might start relying heavily on such functionality which has interensic flaws.
The consumers of the library should implement their own iterators depending on how they'd like to deal with a tree that can change on-the-fly.
