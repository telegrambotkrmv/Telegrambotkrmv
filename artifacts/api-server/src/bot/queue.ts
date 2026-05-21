import { logger } from "../lib/logger";

type Task = {
  id: string;
  fn: () => Promise<void>;
};

class SimpleQueue {
  private queue: Task[] = [];
  private running = 0;
  private concurrency: number;

  constructor(concurrency = 3) {
    this.concurrency = concurrency;
  }

  add(id: string, fn: () => Promise<void>) {
    this.queue.push({ id, fn });
    this.run();
  }

  private async run() {
    if (this.running >= this.concurrency || this.queue.length === 0) return;

    const task = this.queue.shift();
    if (!task) return;

    this.running++;
    try {
      await task.fn();
    } catch (err) {
      logger.error({ err, taskId: task.id }, "Queue task failed");
    } finally {
      this.running--;
      this.run();
    }
  }

  get size() {
    return this.queue.length;
  }

  get active() {
    return this.running;
  }
}

export const downloadQueue = new SimpleQueue(3);
