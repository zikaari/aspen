import { waitFor } from '@testing-library/dom';
import { Branch, Tree } from '../src';
import { findTreeNodeByARN, ItemData, treeSource } from './treeData';


afterEach(() => jest.clearAllMocks());

const assertTree = (tree: Tree<ItemData>, items: string[]): (() => void) => (): void => {
  const levels = tree.visibleTreeNodes.reduce((acc, nodeId) => {
    const treeNode = tree.getTreeNodeById(nodeId);
    return [...acc, '-'.repeat(treeNode.depth) + treeNode.data.name];
  }, []);

  const expected = items.join('\n');
  const actual = levels.join('\n');

  if (expected !== actual) {
    throw new Error(`\nTree expected:\n${expected}\n\nGot:\n${actual}`);
  }
};

describe('Tree', () => {
  it('starts off with only first level nodes expanded and represented by a typed array', async () => {
    jest.spyOn(treeSource, 'getNodes');

    const tree = new Tree(treeSource);

    // here `ensureLoaded` is NOT being called to prove a point that root will be booted up without any manual intervention

    await waitFor(() => expect(Array.from(tree.visibleTreeNodes)).toEqual(expect.arrayContaining([1, 2, 3])));
    expect(tree.visibleTreeNodes.constructor).toBe(Uint32Array);

    // the numbers in the array map to tree nodes
    expect(tree.getTreeNodeById(1).data.name).toBe('archives');
    expect(tree.getTreeNodeById(2).data.name).toBe('files');
    expect(tree.getTreeNodeById(3).data.name).toBe('reports');

    // here's how it'd look
    expect(assertTree(tree, [
      '-archives',
      '-files',
      '-reports'
    ])).not.toThrow();

    // getNodes should be called dynamically as the tree is expanded
    expect(treeSource.getNodes).toHaveBeenCalledTimes(1);
  });

  it('expands the branches and updates the flat projection on-the-fly', async () => {
    jest.spyOn(treeSource, 'getNodes');

    const tree = new Tree(treeSource);

    await tree.ensureLoaded();

    const archivesBranch = await findTreeNodeByARN('arn:aws:s3:::archives', tree);
    await tree.expand(archivesBranch as Branch<ItemData>);

    expect(assertTree(tree, [
      '-archives',
      '--users',
      '--logs',
      '-files',
      '-reports'
    ])).not.toThrow();

    expect(treeSource.getNodes).toHaveBeenCalledTimes(2);

    const logsBranch = await findTreeNodeByARN('arn:aws:s3:::archives/logs', tree);
    await tree.expand(logsBranch as Branch<ItemData>);

    expect(assertTree(tree, [
      '-archives',
      '--users',
      '--logs',
      '---pgp.bat',
      '---applications',
      '-files',
      '-reports'
    ])).not.toThrow();

    expect(treeSource.getNodes).toHaveBeenCalledTimes(3);
  });

  it('expands all parents when a branch is expanded with ensureVisible set to true', async () => {
    jest.spyOn(treeSource, 'getNodes');

    const tree = new Tree(treeSource);

    await tree.ensureLoaded();

    // start-off with just the first level visible
    expect(assertTree(tree, [
      '-archives',
      '-files',
      '-reports'
    ])).not.toThrow();

    const subjectBranch = await findTreeNodeByARN('arn:aws:s3:::archives/logs/applications/approved', tree);
    await tree.expand(subjectBranch as Branch<ItemData>);

    // even after calling expand, the visible tree nodes should be unchanged as parents are still collapsed
    expect(assertTree(tree, [
      '-archives',
      '-files',
      '-reports'
    ])).not.toThrow();

    expect(treeSource.getNodes).toHaveBeenCalledTimes(5);

    // call it again, except this time ask it to reflect at the top
    await tree.expand(subjectBranch as Branch<ItemData>, true);

    expect(assertTree(tree, [
      '-archives',
      '--users',
      '--logs',
      '---pgp.bat',
      '---applications',
      '----approved',
      '-----passport.pdf',
      '-----visa.pdf',
      '-files',
      '-reports'
    ])).not.toThrow();

    // the children had already been loaded earlier, so no new calls to getNodes
    expect(treeSource.getNodes).toHaveBeenCalledTimes(5);
  });

  it('disconnects the entire branch from flattened projection when the said branch is collapsed', async () => {
    jest.spyOn(treeSource, 'getNodes');

    const tree = new Tree(treeSource);

    await tree.ensureLoaded();

    const subjectBranch = await findTreeNodeByARN('arn:aws:s3:::archives/logs/applications/approved', tree);
    // expand one of the very deep branches
    await tree.expand(subjectBranch as Branch<ItemData>, true);

    expect(assertTree(tree, [
      '-archives',
      '--users',
      '--logs',
      '---pgp.bat',
      '---applications',
      '----approved',
      '-----passport.pdf',
      '-----visa.pdf',
      '-files',
      '-reports'
    ])).not.toThrow();

    // now collapse one of its parents
    const parentBranch = await findTreeNodeByARN('arn:aws:s3:::archives/logs', tree);
    tree.collapse(parentBranch as Branch<ItemData>);

    // the entire branch should be disconnected from the visible tree
    expect(assertTree(tree, [
      '-archives',
      '--users',
      '--logs',
      '-files',
      '-reports'
    ])).not.toThrow();

    // expanding it again should restore the state as it was before collapsing
    await tree.expand(parentBranch as Branch<ItemData>);
    expect(assertTree(tree, [
      '-archives',
      '--users',
      '--logs',
      '---pgp.bat',
      '---applications',
      '----approved',
      '-----passport.pdf',
      '-----visa.pdf',
      '-files',
      '-reports'
    ])).not.toThrow();

    // collapse the top level parent
    const topLevelBranch = await findTreeNodeByARN('arn:aws:s3:::archives', tree);
    tree.collapse(topLevelBranch as Branch<ItemData>);
    expect(assertTree(tree, [
      '-archives',
      '-files',
      '-reports'
    ])).not.toThrow();

    // now collapse one of the deeper child of already collapsed parent
    const deepBranch = await findTreeNodeByARN('arn:aws:s3:::archives/logs/applications', tree);
    tree.collapse(deepBranch as Branch<ItemData>);

    // no visible effect, since one of the parent is collapsed anyway
    expect(assertTree(tree, [
      '-archives',
      '-files',
      '-reports'
    ])).not.toThrow();

    // however the effect will be apparant once the said parent is opened up again
    await tree.expand(topLevelBranch as Branch<ItemData>);
    expect(assertTree(tree, [
      '-archives',
      '--users',
      '--logs',
      '---pgp.bat',
      // this was originally expanded but was closed when the top level parent was in closed state
      '---applications',
      '-files',
      '-reports'
    ])).not.toThrow();
  });
});
