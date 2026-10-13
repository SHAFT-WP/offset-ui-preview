// Offset FE calculation requests (Offset BE performance addendum 2026-10-12, P4 / D01-D09).
//
// The FE never calculates. It records the raw edit events, decides WHEN one Flight request is sent,
// and adopts only the answer to the current state. The BE (offset-flight-worker-v0.1.mjs, in a
// Worker) applies the events in order and solves once.
//
// Policy (user decision 2026-10-12, addendum §0):
// - Numeric typing: trailing debounce only. Each input restarts one shared 200 ms timer; the request
//   is sent when it expires. No leading call, throttle, periodic run or maxWait.
// - Enter, LOCK, option / selection buttons: sent at once with every pending edit (timer cancelled).
// - change / blur of a numeric field: its commit event joins the pending edits. While the timer runs
//   it rides on that request without extending it; with nothing pending it is sent at once (the BE
//   applies the commit transition and reuses its solves when nothing else changed).
// - Reset / load: the pending edits and timer are dropped and older answers can no longer apply.
// - Every edit raises the revision at once. An answer applies only when it was computed from the
//   current revision; an older answer (success, failure or anything else) changes nothing, and its
//   edits stay pending and go out again with the next request, so no edit is lost or applied twice.
// - One request in flight. While it runs, later requests collapse into one latest request, sent the
//   moment the answer arrives (a deadline that already passed is not extended).
// A timer cancel or a dropped answer does not stop a calculation already running in the Worker.

export const DEBOUNCE_DELAY_MS = 200;

export function createCalculationScheduler({ collect, apply, transport, delayMs = DEBOUNCE_DELAY_MS, timers = globalThis, onEvent = null }) {
  let revision = 0;
  let generation = 0;
  let nextEditId = 1;
  let nextRequestId = 1;
  let pending = [];
  let timer = null;
  let sendWanted = false;
  // An empty field waits for its next character or its commit (user rule 2026-09-28): no request.
  let held = false;
  let inFlight = null;
  let idleWaiters = [];
  const counters = { requests: 0, adopted: 0, stale: 0 };
  const emit = (type, detail = {}) => onEvent?.({ type, revision, ...detail });

  const idle = () => !timer && !sendWanted && !inFlight;
  // (A held field counts as idle: nothing is being computed for it.)
  const settleWaiters = () => {
    if (!idle()) return;
    const waiters = idleWaiters;
    idleWaiters = [];
    waiters.forEach((resolve) => resolve());
  };
  const cancelTimer = () => {
    if (timer !== null) timers.clearTimeout(timer);
    timer = null;
  };
  const record = (edit) => {
    revision += 1;
    held = false;
    if (edit) pending.push({ id: nextEditId++, edit });
  };

  function trySend() {
    if (!sendWanted || inFlight) return;
    sendWanted = false;
    const edits = pending.map((item) => item.edit);
    const input = collect(edits);
    inFlight = { requestId: nextRequestId++, revision, generation, input, edits };
    counters.requests += 1;
    emit("send", { requestId: inFlight.requestId, edits: edits.length });
    transport.send({ type: "calculate", requestId: inFlight.requestId, input }, inFlight);
  }

  function want() {
    sendWanted = true;
    trySend();
  }

  function receive(message) {
    if (!inFlight || message?.requestId !== inFlight.requestId) return;
    const sent = inFlight;
    inFlight = null;
    if (sent.revision === revision && sent.generation === generation) {
      // Nothing was edited since this request was collected: every pending edit went with it.
      pending = [];
      counters.adopted += 1;
      emit("adopt", { requestId: sent.requestId });
      apply(message, sent);
    } else {
      counters.stale += 1;
      emit("stale", { requestId: sent.requestId });
      // The current state is computed by the timer, the queued request or, failing both, now.
      if (!timer && !sendWanted && !held && sent.generation === generation) sendWanted = true;
    }
    trySend();
    settleWaiters();
  }

  transport.onMessage(receive);

  return {
    // Numeric typing (`input`): the edit is recorded now; the request waits for 200 ms of quiet.
    input(edit) {
      record(edit);
      cancelTimer();
      timer = timers.setTimeout(() => {
        timer = null;
        emit("deadline");
        want();
      }, delayMs);
      emit("input");
    },
    // Numeric commit (`change`, blur): rides on a waiting request, else is sent now.
    commit(edit) {
      record(edit);
      emit("commit");
      if (timer === null) want();
    },
    // Enter, LOCK, buttons, selections: every pending edit plus this one, sent now.
    immediate(edit = null) {
      record(edit);
      cancelTimer();
      emit("immediate");
      want();
    },
    // A field was emptied: no request until it gets a character or its commit; edits already typed
    // stay pending and go with that next request.
    hold() {
      revision += 1;
      cancelTimer();
      held = true;
      emit("hold");
    },
    // Reset / load: earlier edits (except those `keep` accepts, e.g. other tabs' edits for a tab
    // Default) and earlier answers no longer apply; the new state is sent now.
    reset(keep = null) {
      pending = keep ? pending.filter((item) => keep(item.edit)) : [];
      cancelTimer();
      revision += 1;
      generation += 1;
      held = false;
      emit("reset");
      want();
    },
    // Sends a waiting request now and resolves when the current state has its answer (Save).
    flush() {
      if (timer !== null) {
        cancelTimer();
        want();
      }
      return this.whenIdle();
    },
    whenIdle() {
      return idle() ? Promise.resolve() : new Promise((resolve) => idleWaiters.push(resolve));
    },
    // Last value of a LOCK / option toggle among the edits not yet answered (so a second click
    // before the answer toggles back instead of repeating the first click).
    pendingToggle(aircraft, kind, key) {
      for (let index = pending.length - 1; index >= 0; index -= 1) {
        const edit = pending[index].edit;
        if ((edit.aircraft ?? 1) === aircraft && edit.kind === kind && edit.key === key) return edit.value;
      }
      return undefined;
    },
    state() {
      return { revision, generation, pendingEdits: pending.length, timer: timer !== null, sendWanted, held, inFlight: inFlight ? { requestId: inFlight.requestId, revision: inFlight.revision, edits: inFlight.edits.length } : null, ...counters };
    },
  };
}

// Worker transport: a module Worker running the BE host; if it cannot start, the same host module
// runs on the page (still answered asynchronously, so the request rules are unchanged). `hostFactory`
// names the host module's factory export (2026-10-13: the SEM & Rejoin host uses the same transport).
export function createWorkerTransport({ workerUrl, hostModuleUrl = workerUrl, hostFactory = "createOffsetFlightHost", WorkerClass = globalThis.Worker, onFallback = null }) {
  let listener = () => {};
  let worker = null;
  let fallbackHost = null;
  let queue = [];
  const deliver = (message) => listener(message);
  const runFallback = async (message) => {
    if (!fallbackHost) {
      const module = await import(hostModuleUrl);
      fallbackHost = module[hostFactory]();
    }
    setTimeout(() => {
      deliver(fallbackHost.handle(message));
      setTimeout(() => fallbackHost.prepareIdle(), 0);
    }, 0);
  };
  const fallBack = (reason) => {
    if (worker) {
      try { worker.terminate(); } catch { /* already gone */ }
    }
    worker = null;
    onFallback?.(reason);
    const waiting = queue;
    queue = [];
    waiting.forEach((message) => runFallback(message));
  };
  try {
    if (typeof WorkerClass !== "function") throw new Error("Worker is not available");
    worker = new WorkerClass(workerUrl, { type: "module" });
    worker.addEventListener("message", (event) => {
      const message = event.data;
      if (message?.type === "result" || message?.type === "error") {
        queue = queue.filter((item) => item.requestId !== message.requestId);
        deliver(message);
      }
    });
    // A module that fails to load reports an error event; the requests it holds move on-page.
    worker.addEventListener("error", (event) => {
      event.preventDefault?.();
      fallBack(event.message || "worker error");
    });
  } catch (error) {
    worker = null;
    onFallback?.(error.message);
  }
  return {
    send(message) {
      if (worker) {
        queue.push(message);
        worker.postMessage(message);
      } else {
        runFallback(message);
      }
    },
    onMessage(fn) {
      listener = fn;
    },
    mode: () => (worker ? "worker" : "page"),
  };
}
