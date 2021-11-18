import React, { useMemo } from 'react';
import { FixedSizeList } from 'react-window';
import { Tree } from 'aspen-core';

import { RenderableItem, useTreeController } from './hooks';

export * from 'aspen-core';

export type ItemComponentProps<NodeDataT> = {
  tree: Tree;
  item: RenderableItem<NodeDataT>;
};

export type ItemComponent<NodeDataT> = React.FC<ItemComponentProps<NodeDataT>> & {
  renderHeight: number;
};

export type TreeViewProps<NodeDataT> = {
  tree: Tree;
  width: number;
  height: number;
  itemComponent: ItemComponent<NodeDataT>;
  style?: React.CSSProperties;
  className?: string;
};

export const TreeView = <NodeDataT extends {} = {}>({
  tree,
  width,
  height,
  itemComponent,
  style,
  className
}: TreeViewProps<NodeDataT>): JSX.Element => {
  const {
    itemCount,
    getRenderableItemAtIndex,
    getItemKeyAtIndex
  } = useTreeController(tree);

  const itemData = useMemo(
    () => ({ tree, getRenderableItemAtIndex, itemComponent }),
    [tree, getRenderableItemAtIndex, itemComponent]
  );

  return (
    <FixedSizeList
      width={width}
      height={height}
      itemData={itemData}
      itemSize={itemComponent.renderHeight}
      itemKey={getItemKeyAtIndex}
      itemCount={itemCount}
      overscanCount={5}
      style={style}
      className={className}>
      {ListItem}
    </FixedSizeList>);
};

type ListItemProps<NodeDataT> = {
  index: number;
  style: React.CSSProperties;
  data: {
    tree: Tree;
    getRenderableItemAtIndex: (i: number) => RenderableItem<NodeDataT>;
    itemComponent: ItemComponent<NodeDataT>;
  };
};

const ListItem = <NodeDataT extends {}>({ index, data, style }: ListItemProps<NodeDataT>): JSX.Element => {
  const ItemComponent = data.itemComponent;

  return (
    <div style={style} >
      <ItemComponent tree={data.tree} item={data.getRenderableItemAtIndex(index)} />
    </div>
  );
};
