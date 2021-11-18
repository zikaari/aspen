import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Tree, TreeNode } from 'aspen-core';


export type RenderableItem<NodeDataT> = { node: TreeNode<NodeDataT>; } | { prompt: {/* TODO */ } };

export type TreeController<NodeDataT> = {
  itemCount: number;
  getRenderableItemAtIndex: (i: number) => RenderableItem<NodeDataT>;
  getItemKeyAtIndex: (i: number) => string;
};

export const useTreeController = <NodeDataT>(tree: Tree<NodeDataT>): TreeController<NodeDataT> => {
  /**
   * This cache exists so we re-use object references for respective indices whenever possible
   * React does a shallow reference equality check when deciding if a component should re-render
   * This cache needs to be reset whenever the visible nodes change OR prompts are added/removed
   * */
  const renderableItemCache = useRef<Map<number, RenderableItem<NodeDataT>>>();
  const [visibleNodes, setVisibleNodes] = useState<Uint32Array>(tree.visibleTreeNodes);

  const getRenderableItemAtIndex = useCallback((index: number): RenderableItem<NodeDataT> => {
    if (!renderableItemCache.current.has(index)) {
      renderableItemCache.current.set(index, {
        node: tree.getTreeNodeById(visibleNodes[index])
      });
    }

    return renderableItemCache.current.get(index);
  }, [visibleNodes]);

  const getItemKeyAtIndex = useCallback((index: number): string => {
    const item = getRenderableItemAtIndex(index);

    if ('prompt' in item) {
      return `prompt@TODO`;
    } else {
      return `treenode@${item.node.id}`;
    }

  }, [visibleNodes, getRenderableItemAtIndex]);

  useLayoutEffect(() => {
    renderableItemCache.current = new Map();
    setVisibleNodes(tree.visibleTreeNodes);

    return tree.onDidChangeVisibleTreeNodes(() => {
      renderableItemCache.current?.clear();
      setVisibleNodes(tree.visibleTreeNodes);
    });
  }, [tree]);

  return useMemo(
    () => {
      return {
        itemCount: visibleNodes?.length || 0,
        getRenderableItemAtIndex,
        getItemKeyAtIndex,
      };
    },
    [tree, visibleNodes]
  );
};
