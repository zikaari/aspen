import { Branch } from './Branch';

export class Leaf<T extends {} = {}> {
  constructor(
    public readonly id: number,
    public readonly parent: Branch<T>,
    public data: T
  ) { }

  get depth(): number {
    if (!this.parent) {
      return 0;
    }

    return this.parent.depth + 1;
  }
}
