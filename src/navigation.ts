/** One owner for browser Back, dialog Back and completed multi-step flows. */
export function createNavigation<T>(initial: T, apply: (state: T) => void, canLeave: (from: T, to: T) => boolean) {
  const session = crypto.randomUUID();
  const entries: T[] = [initial];
  let index = 0;
  let restoring = false;
  let resetting = false;
  let pending: { index: number; next?: T; replace?: boolean } | null = null;
  const write = (method: "pushState" | "replaceState") => {
    history[method]({ ...history.state, yomu: { session, index } }, "");
  };
  history.scrollRestoration = "manual";
  const previousIndex = history.state?.yomu?.index;
  if (Number.isInteger(previousIndex) && previousIndex > 0 && previousIndex < history.length) {
    // A reload starts a fresh shelf session. Unwind the old in-app entries so
    // one Back at the root can leave the app instead of consuming stale screens.
    resetting = true;
    history.go(-previousIndex);
  } else write("replaceState");

  function push(next: T) {
    if (pending || restoring || resetting || !canLeave(entries[index]!, next)) return;
    entries.splice(index + 1);
    entries.push(next);
    index += 1;
    write("pushState");
    apply(next);
  }

  function returnTo(matches: (state: T) => boolean, next?: T, replace = false) {
    if (pending || restoring || resetting) return;
    let target = index - 1;
    while (target > 0 && !matches(entries[target]!)) target -= 1;
    if (target < 0) return;
    if (!canLeave(entries[index]!, next ?? entries[target]!)) return;
    pending = { index: target, next, replace };
    history.go(target - index);
  }

  window.addEventListener("popstate", event => {
    if (resetting) { resetting = false; write("replaceState"); return; }
    const target = event.state?.yomu as { session?: string; index?: number } | undefined;
    if (target?.session !== session || typeof target.index !== "number" || !entries[target.index]) return;
    if (restoring) { restoring = false; return; }
    const targetIndex = target.index;
    if (!pending && !canLeave(entries[index]!, entries[targetIndex]!)) {
      restoring = true;
      history.go(index - targetIndex);
      return;
    }
    index = targetIndex;
    const next = pending?.index === index ? pending.next : undefined;
    const replace = pending?.replace;
    pending = null;
    if (next && replace) {
      entries[index] = next;
      entries.splice(index + 1);
      write("replaceState");
    } else if (next) {
      entries.splice(index + 1);
      entries.push(next);
      index += 1;
      write("pushState");
    }
    apply(entries[index]!);
  });

  return {
    push,
    returnTo,
    back: () => returnTo(() => true),
    update: (state: T) => { entries[index] = state; },
    current: () => entries[index]!,
  };
}
