// 输入一变化就作废旧响应，而不是等防抖到期才作废。
export function createPlaceSearch({ search, onResult, onStatus, debounceMs = 300 }) {
  let revision = 0, timer, controller;
  function cancel() { revision++; clearTimeout(timer); controller?.abort(); }
  return {
    cancel,
    update(query) {
      cancel(); onResult([]);
      const q = query.trim(), current = revision;
      if (!q) { onStatus('idle'); return; }
      onStatus('waiting');
      timer = setTimeout(async () => {
        controller = new AbortController(); onStatus('loading');
        try {
          const places = await search(q, controller.signal);
          if (current !== revision) return;
          onResult(places); onStatus(places.length ? 'success' : 'empty');
        } catch (error) { if (current === revision && error.name !== 'AbortError') onStatus('error', error); }
      }, debounceMs);
    },
  };
}
