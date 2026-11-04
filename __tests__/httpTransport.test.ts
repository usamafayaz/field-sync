import { AbortedError, TimeoutError } from '../src/delivery/errors';
import { xhrTransport } from '../src/platform/httpTransport';

/** A request that never answers, and whose abort() fires onabort synchronously, like React Native's. */
class SilentXhr {
  onload?: () => void;
  onerror?: () => void;
  onabort?: () => void;
  upload = {};
  open() {}
  setRequestHeader() {}
  send() {}
  abort() {
    this.onabort?.();
  }
}

describe('xhrTransport', () => {
  const realXhr = global.XMLHttpRequest;
  beforeEach(() => {
    jest.useFakeTimers();
    (global as any).XMLHttpRequest = SilentXhr;
  });
  afterEach(() => {
    jest.useRealTimers();
    global.XMLHttpRequest = realXhr;
  });

  it('reports a hung request as a timeout, not as a cancellation', async () => {
    const pending = xhrTransport.request({ method: 'GET', url: 'http://x', timeoutMs: 1000 });
    jest.advanceTimersByTime(1000);
    await expect(pending).rejects.toBeInstanceOf(TimeoutError);
  });

  it('times out a stalled upload early, but not one that keeps moving', async () => {
    let xhr!: SilentXhr & { upload: { onprogress?: (e: { loaded: number }) => void } };
    (global as any).XMLHttpRequest = class extends SilentXhr {
      constructor() {
        super();
        xhr = this as any;
      }
    };
    const pending = xhrTransport.request({ method: 'PATCH', url: 'http://x', timeoutMs: 60_000, idleTimeoutMs: 1000 });
    jest.advanceTimersByTime(900);
    xhr.upload.onprogress?.({ loaded: 10 });
    jest.advanceTimersByTime(900);
    xhr.upload.onprogress?.({ loaded: 20 });
    jest.advanceTimersByTime(1000);
    await expect(pending).rejects.toBeInstanceOf(TimeoutError);
  });

  it('reports a cancelled request as a cancellation', async () => {
    const controller = new AbortController();
    const pending = xhrTransport.request({ method: 'GET', url: 'http://x', timeoutMs: 1000, signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toBeInstanceOf(AbortedError);
  });
});
