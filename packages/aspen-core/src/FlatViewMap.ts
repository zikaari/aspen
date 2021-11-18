type K = number;
type V = Uint32Array;

export class FlatViewMap extends Map<K, V> {
  public onDidSetKey: (key: K, value: V) => void;

  set(key: K, value: V): this {
    super.set(key, value);
    this.onDidSetKey?.(key, value);
    return this;
  }
}
