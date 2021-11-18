import { Branch, Tree, TreeNode, TreeSource } from '../src';

export type ItemData = {
  name: string;
  arn: string;
  children?: ItemData[];
};

const rawData: ItemData[] = [
  {
    name: 'archives',
    arn: 'arn:aws:s3:::archives',
    children: [
      {
        name: 'users',
        arn: 'arn:aws:s3:::archives/users',
        children: [
          {
            name: 'trevor.txt',
            arn: 'arn:aws:s3:::archives/users/trevor.txt'
          },
          {
            name: 'melinda.txt',
            arn: 'arn:aws:s3:::archives/users/melinda.txt'
          },
        ]
      },
      {
        name: 'logs',
        arn: 'arn:aws:s3:::archives/logs',
        children: [
          {
            name: 'pgp.bat',
            arn: 'arn:aws:s3:::archives/logs/pgp.bat'
          },
          {
            name: 'applications',
            arn: 'arn:aws:s3:::archives/logs/applications',
            children: [
              {
                name: 'approved',
                arn: 'arn:aws:s3:::archives/logs/applications/approved',
                children: [
                  {
                    name: 'passport.pdf',
                    arn: 'arn:aws:s3:::archives/logs/applications/approved/passport.pdf'
                  },
                  {
                    name: 'visa.pdf',
                    arn: 'arn:aws:s3:::archives/logs/applications/approved/visa.pdf'
                  },
                ]
              }
            ]
          },
        ]
      },

    ]
  },
  {
    name: 'files',
    arn: 'arn:aws:s3:::files',
    children: []
  },
  {
    name: 'reports',
    arn: 'arn:aws:s3:::reports',
    children: [
      {
        name: 'expenses.xlsx',
        arn: 'arn:aws:s3:::reports/expenses.xlsx'
      }
    ]
  },
];

export const treeSource: TreeSource<ItemData> = {
  getNodes: (branch, factory): TreeNode<ItemData>[] => {
    const findItem = (arn: string, scope: ItemData[]): ItemData => {
      for (const item of scope) {
        if (item.arn === arn) {
          return item;
        }
        if (item.children) {
          const res = findItem(arn, item.children);
          if (res) {
            return res;
          }
        }
      }
    };

    const children = !branch ? rawData : findItem(branch.data.arn, rawData).children;
    return (children || []).map(item => (
      item.children
        ? factory.createBranch(item)
        : factory.createLeaf(item))
    );
  }
};

export const findTreeNodeByARN = (arn: string, tree: Tree<ItemData>): Promise<TreeNode<ItemData>> => {
  const search = async (branch: Branch<ItemData>): Promise<TreeNode<ItemData>> => {
    await tree.ensureLoaded(branch);
    for (const node of branch.nodes) {
      if (arn === node.data.arn) {
        return node;
      }

      if (arn.includes(node.data.arn) && Tree.isBranch(node)) {
        return search(node as Branch<ItemData>);
      }
    }
  };

  return search(tree.root);
};
