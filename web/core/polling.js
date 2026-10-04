/** One scheduled refresh at a time; stopping invalidates an in-flight repeat. */
export function createPoller(task, { delay, enabled = () => true, repeat = true, timers = globalThis, onError = () => {} }) {
  let timer = null;
  let generation = 0;
  function stop() {
    generation++;
    if (timer !== null) timers.clearTimeout(timer);
    timer = null;
  }
  function schedule() {
    stop();
    if (!enabled()) return;
    const current = generation;
    timer = timers.setTimeout(async () => {
      timer = null;
      try { if (enabled()) await task(); }
      catch (error) { onError(error); }
      finally { if (repeat && current === generation) schedule(); }
    }, delay);
  }
  return { schedule, stop };
}
