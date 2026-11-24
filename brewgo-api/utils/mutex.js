// Tiny in-process lock, so two requests that change the SAME thing (one customer's cart, one order)
// run one after the other instead of overwriting each other. It holds no data (the data is in Supabase).
// Works because the API runs as a single instance.
const tails = new Map();

async function acquire(key) {
  const previous = tails.get(key) || Promise.resolve();
  let open;
  const gate = new Promise((resolve) => { open = resolve; });
  const tail = previous.then(() => gate);
  tails.set(key, tail);
  await previous;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    open();
    if (tails.get(key) === tail) tails.delete(key);
  };
}

async function withLock(key, fn) {
  const release = await acquire(key);
  try { return await fn(); } finally { release(); }
}

module.exports = { acquire, withLock };
