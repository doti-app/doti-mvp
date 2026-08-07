// @ts-check

/**
 * Serializes optimistic operation saves. The adapter receives immutable
 * snapshots, which keeps persistence independent from DOM and page code.
 * @template Snapshot
 * @param {{
 *   write: (snapshot: Snapshot, expectedRevision: number) => Promise<number>,
 *   onError: (error: unknown) => void | Promise<void>,
 *   onIdle?: () => void | Promise<void>
 * }} options
 */
export function createOperationPersistence(options) {
  /** @type {{ snapshot: Snapshot, expectedRevision: number, epoch: number, resolve: (saved: boolean) => void }[]} */
  let queue = [];
  let running = false;
  let epoch = 0;

  async function flush() {
    if (running) return;
    running = true;
    try {
      while (queue.length) {
        const entry = queue.shift();
        if (!entry || entry.epoch !== epoch) {
          entry?.resolve(false);
          continue;
        }
        try {
          await options.write(entry.snapshot, entry.expectedRevision);
          entry.resolve(true);
        } catch (error) {
          epoch += 1;
          queue.splice(0).forEach(pending => pending.resolve(false));
          entry.resolve(false);
          await options.onError(error);
          break;
        }
      }
    } finally {
      running = false;
      if (!queue.length) await options.onIdle?.();
    }
  }

  return {
    /** @param {Snapshot} snapshot @param {number} expectedRevision */
    enqueue(snapshot, expectedRevision) {
      const completion = new Promise(resolve => {
        queue.push({ snapshot, expectedRevision, epoch, resolve });
      });
      void flush();
      return completion;
    },
    reset() {
      epoch += 1;
      queue.splice(0).forEach(entry => entry.resolve(false));
    },
    get isRunning() {
      return running;
    },
    get hasPending() {
      return queue.length > 0;
    }
  };
}
