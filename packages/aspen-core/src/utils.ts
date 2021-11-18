/**
 * Like Array.prototype.splice except this method won't throw
 * RangeError when given too many items (with spread operator as `...items`)
 *
 * Also items are concated straight up without having to use the spread operator
 *
 * Performance is more or less same as Array.prototype.splice
 *
 * @param arr Array to splice
 * @param start Start index where splicing should begin
 * @param deleteCount Items to delete (optionally replace with given items)
 * @param items Items to insert (when deleteCount is same as items.length, it becomes a replace)
 */
export const spliceTypedArray = (arr: Uint32Array, start: number, deleteCount = 0, items?: Uint32Array): { deleted: Uint32Array; spliced: Uint32Array; } => {
  const deleted = new Uint32Array(deleteCount);
  const spliced = new Uint32Array((arr.length - deleteCount) + (items ? items.length : 0));
  deleted.set(arr.subarray(start, start + deleteCount));
  spliced.set(arr.subarray(0, start));
  if (items) {
    spliced.set(items, start);
  }
  spliced.set(arr.subarray(start + deleteCount, arr.length), (start + (items ? items.length : 0)));
  return { spliced, deleted };
};

export const last = <T>(arr: ReadonlyArray<T>): T => arr[arr.length - 1];
