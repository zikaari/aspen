import { TreeNode, TreeSource, TreeNodeFactory } from './types';
import { Branch } from './Branch';
import { Leaf } from './Leaf';
import { last, spliceTypedArray } from './utils';
import { BranchAmendContext, TreeNodeComparator } from '.';
import { FlatViewMap } from './FlatViewMap';


export class Tree<NodeDataT extends {} = {}> {
  private rootBranch: Branch<NodeDataT>;
  private flatViewMap = new FlatViewMap();
  private treeNodeMap = new Map<number, TreeNode<NodeDataT>>();
  private pendingLoadChildrenRequests = new Map<Branch, Promise<void>>();
  private onVisibleNodesChangeCallback: () => void = () => void 0;

  public static isLeaf = <T>(treeNode: TreeNode<T>): treeNode is Leaf<T> => treeNode.constructor === Leaf;
  public static isBranch = <T>(treeNode: TreeNode<T>): treeNode is Branch<T> => treeNode.constructor === Branch;

  constructor(private source: TreeSource<NodeDataT>, rootBranchData?: NodeDataT) {
    this.rootBranch = new Branch(this.nextId(), null, rootBranchData);
    this.flatViewMap.onDidSetKey = (key: number): void => key === this.rootBranch.id && this.onVisibleNodesChangeCallback?.();
    this.expand(this.rootBranch);
  }

  onDidChangeVisibleTreeNodes(cb: () => void): void {
    this.onVisibleNodesChangeCallback = cb;
  }

  get root(): Branch<NodeDataT> {
    return this.rootBranch;
  }

  get visibleTreeNodes(): Uint32Array {
    return this.flatViewMap.get(this.rootBranch.id);
  }

  getTreeNodeById = (id: number): TreeNode<NodeDataT> => this.treeNodeMap.get(id);

  /**
   * Ensures that the children of any given branch have been loaded and ready to be worked with.
   *
   * Call this method without any arguments to check if the root branch is loaded.
   *
   * ⚠ "Loaded" doesn't mean expanded, it just means the contents are "ready". Except when no arguments are given, the
   * branch being checked is root, and root is always expanded.
   */
  ensureLoaded = async (branch: Branch<NodeDataT> = this.rootBranch): Promise<void> => {
    if (!branch.nodes) {
      return this.loadNodes(branch);
    }
  };

  expand = async (branch: Branch<NodeDataT>, ensureVisible = false, recursive = false): Promise<void> => {
    const isVisibilitySkipable = !ensureVisible || (ensureVisible && this.isVisible(branch));

    if (!recursive && this.isTrulyExpanded(branch) && isVisibilitySkipable) {
      return;
    }

    (branch.expanded as boolean) = true;

    await this.ensureLoaded(branch);

    // check again as collapse might have been called in the meantime
    if (branch.expanded) {
      this.connectBranchToClosestFlatView(branch, ensureVisible);

      if (recursive) {
        await Promise.all(branch.nodes.map(node =>
          Tree.isBranch(node)
            ? this.expand(node, ensureVisible, recursive)
            : null
        ));
      }
    }
  };

  collapse = (branch: Branch<NodeDataT>): void => {
    if (branch.expanded) {
      this.disconnectBranchFromClosestFlatView(branch);
    }

  };

  amend = (branch: Branch<NodeDataT>, amendFn: ((ctx: BranchAmendContext<NodeDataT>) => void)): void => {
    let modified = false;
    let draftNodes: TreeNode<NodeDataT>[] = branch.nodes.slice();
    const factory = this.getTreeNodeFactory(branch);
    const insertNode = <NodeType extends TreeNode<NodeDataT>>(node: NodeType, insertionIndex: number): NodeType => {
      modified = true;
      draftNodes.splice(insertionIndex ?? Infinity, 0, node);
      return node;
    };

    amendFn({
      draftNodes,
      insertBranch: (data: NodeDataT, insertionIndex?: number) => insertNode(factory.createBranch(data), insertionIndex),
      insertLeaf: (data: NodeDataT, insertionIndex?: number) => insertNode(factory.createLeaf(data), insertionIndex),
      sort: (comparatorFn: TreeNodeComparator<NodeDataT>) => {
        modified = true;
        draftNodes.sort(comparatorFn);
      },
      revertChanges: () => {
        modified = false;
        draftNodes = branch.nodes.slice();
      }
    });

    if (modified) {
      this.setNodes(branch, draftNodes);
    }
  };

  removeNode = (node: TreeNode<NodeDataT>): void => {
    const teardown = (childNode: TreeNode): void => {
      // TODO: dispatch remove event
      this.removeNodeFromFlatView(childNode);
      this.treeNodeMap.delete(childNode.id);

      if (Tree.isBranch(childNode)) {
        childNode.nodes?.forEach(teardown);
      }
    };

    teardown(node);

    const { parent } = node;
    (parent.nodes as ReadonlyArray<TreeNode>) = parent.nodes.filter(n => n !== node);
  };

  moveNode = (node: TreeNode<NodeDataT>, to: Branch<NodeDataT>): void => {

  };

  /**
   * A more accurate and real-time representation of whether a branch is expanded.
   *
   * `Branch#expanded` represents the "intended" expansion state of the branch in question not the actual
   * status, because the child nodes might still need to be loaded before the change can be seen in the tree.
   */
  isTrulyExpanded = (branch: Branch<NodeDataT>): boolean => branch.nodes && branch.expanded && !this.flatViewMap.has(branch.id);

  isVisible = (node: TreeNode<NodeDataT>): boolean => !this.findClosestDisconnectedParent(node);

  private nextId = ((genesis = 0) => ((): number => genesis++))();

  private async loadNodes(parent: Branch<NodeDataT>): Promise<void> {
    if (!this.pendingLoadChildrenRequests.has(parent)) {
      const promise = (async (): Promise<void> => {
        const nodes = await this.source.getNodes(
          parent === this.rootBranch ? null : parent,
          this.getTreeNodeFactory(parent)
        );

        this.setNodes(parent, nodes);

        for (const node of nodes) {
          if (Tree.isBranch(node) && node.expanded) {
            this.expand(node);
          }
        }
      })();

      promise.finally(() => this.pendingLoadChildrenRequests.delete(parent));
      this.pendingLoadChildrenRequests.set(parent, promise);
    }

    return this.pendingLoadChildrenRequests.get(parent);
  }

  private setNodes(branch: Branch<NodeDataT>, nodes: TreeNode<NodeDataT>[]): void {
    const restoreExpansionQueue: Branch[] = [];

    if (branch.nodes) {
      if (branch.expanded) {
        this.disconnectBranchFromClosestFlatView(branch);
        restoreExpansionQueue.unshift(branch);
      }

      for (const node of branch.nodes) {
        if (!nodes.includes(node)) {
          throw new Error('Fatal: Missing node in new nodes array. This is a bug in `aspen-core` please file an issue along with repro steps');
        }

        // if a child branch is expanded, we must disconnect it (will be reconnected later)
        if (Tree.isBranch(node) && node.expanded) {
          this.disconnectBranchFromClosestFlatView(node);
          restoreExpansionQueue.unshift(node);
        }
      }
    }


    (branch.nodes as ReadonlyArray<TreeNode>) = nodes;

    const flatView = new Uint32Array(branch.nodes.length);
    for (let i = 0; i < branch.nodes.length; i++) {
      const child = branch.nodes[i];
      flatView[i] = child.id;
      this.treeNodeMap.set(child.id, child);
    }

    // save the updated flat projection
    this.flatViewMap.set(branch.id, flatView);

    for (const node of restoreExpansionQueue) {
      this.connectBranchToClosestFlatView(node);
    }
  }

  private getTreeNodeFactory(branch: Branch<NodeDataT>): TreeNodeFactory<NodeDataT> {
    return {
      createBranch: (data: NodeDataT, expanded?: boolean): Branch<NodeDataT> => new Branch(this.nextId(), branch, data, expanded),
      createLeaf: (data: NodeDataT): Leaf<NodeDataT> => new Leaf(this.nextId(), branch, data)
    };
  }

  private removeNodeFromFlatView(node: TreeNode): void {
    // if the node (branch) was in a disconnected state, remove its records
    if (this.flatViewMap.has(node.id)) {
      this.flatViewMap.delete(node.id);
    }

    // proceed with the complete removal from the shadow parent

    const shadowParent = this.findClosestDisconnectedParent(node) || this.rootBranch;
    const parentFlatView = this.flatViewMap.get(shadowParent.id);
    const { start, end } = this.getNodeProjectionRangeWithinFlatView(parentFlatView, node);
    const { spliced } = spliceTypedArray(parentFlatView, start, end - start);

    if (Tree.isBranch(node)) {
      (node.expanded as boolean) = false;
    }

    this.flatViewMap.set(shadowParent.id, spliced);
  }

  private disconnectBranchFromClosestFlatView(branch: Branch): void {
    // if is NOT root branch, and is connected to a shadow parent
    if (!this.isRootBranch(branch) && !this.flatViewMap.has(branch.id)) {
      const shadowParent = this.findClosestDisconnectedParent(branch) || this.rootBranch;
      const parentFlatView = this.flatViewMap.get(shadowParent.id);
      const { start, end } = this.getNodeProjectionRangeWithinFlatView(parentFlatView, branch);
      const { spliced, deleted } = spliceTypedArray(parentFlatView, start + 1, end - start);

      (branch.expanded as boolean) = false;
      this.flatViewMap.set(shadowParent.id, spliced);
      this.flatViewMap.set(branch.id, deleted);
    }
  }

  private connectBranchToClosestFlatView(branch: Branch, liftToRoot = false): void {
    const shadowParent = this.findClosestDisconnectedParent(branch) || this.rootBranch;

    // if is NOT root branch, and is disconnected from its shadow parent
    if (!this.isRootBranch(branch) && this.flatViewMap.has(branch.id)) {
      const parentFlatView = this.flatViewMap.get(shadowParent.id);
      const fromIdx = parentFlatView.indexOf(branch.id) + 1;
      const selfFlatView = this.flatViewMap.get(branch.id);
      const { spliced } = spliceTypedArray(parentFlatView, fromIdx, 0, selfFlatView);

      (branch.expanded as boolean) = true;
      this.flatViewMap.set(shadowParent.id, spliced);
      this.flatViewMap.delete(branch.id);
    }

    if (liftToRoot && !this.isRootBranch(shadowParent)) {
      this.connectBranchToClosestFlatView(shadowParent, true);
    }
  }

  private isRootBranch(branch: Branch): boolean {
    return branch === this.rootBranch;
  }

  private findClosestDisconnectedParent(node: TreeNode): Branch {
    let p = node.parent;
    while (p) {
      if (!p.expanded) {
        return p;
      }
      p = p.parent;
    }
  }

  private getNodeProjectionRangeWithinFlatView(flatView: Uint32Array, node: TreeNode): { start: number; end: number; } {
    let b = node;
    // keep walking up until we find a branch that is NOT the last child of its parent
    while (last(b.parent.nodes) === b) {
      b = b.parent;
    }

    // once we have that, just return the immediate next sibling node
    const nextSibling = b.parent.nodes[b.parent.nodes.indexOf(b) + 1];

    const startIndex = flatView.indexOf(node.id);
    const endIndex = flatView.indexOf(nextSibling.id);

    return {
      start: startIndex,
      end: (endIndex > -1 ? endIndex : flatView.length) - 1
    };
  }
}
