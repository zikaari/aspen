import { Branch } from './Branch';
import { Leaf } from './Leaf';


export type TreeNode<NodeDataT extends {} = {}> = (Leaf<NodeDataT> | Branch<NodeDataT>);

export type TreeNodeFactory<NodeDataT extends {} = {}> = {
  createBranch: (data: NodeDataT, expanded?: boolean) => Branch<NodeDataT>;
  createLeaf: (data: NodeDataT) => Leaf<NodeDataT>;
}

export type TreeSource<NodeDataT extends {} = {}> = {
  getNodes: (parent: Branch<NodeDataT>, factory: TreeNodeFactory<NodeDataT>) => TreeNode<NodeDataT>[] | Promise<TreeNode<NodeDataT>[]>;
}

export type TreeNodeComparator<NodeDataT extends {}> = (a: TreeNode<NodeDataT>, b: TreeNode<NodeDataT>) => number;

export type BranchAmendContext<NodeDataT extends {}> = {
  /**
   * Realtime representation of nodes of the target branch. This is a readonly copy that updates after any operation is performed.
   *
   * It starts of with the current child nodes of the branch, and mutates as you run operation on it. The mutations will be commited
   * to the actual tree after the amend function returns. Calling `revertChanges` will reset the copy back to how it was and no changes
   * will be saved.
   */
  draftNodes: ReadonlyArray<TreeNode<NodeDataT>>;
  insertLeaf: (data: NodeDataT, insertionIndex?: number) => Leaf<NodeDataT>;
  insertBranch: (data: NodeDataT, insertionIndex?: number) => Branch<NodeDataT>;
  sort: (comparatorFn: TreeNodeComparator<NodeDataT>) => void;
  revertChanges: () => void;
};
