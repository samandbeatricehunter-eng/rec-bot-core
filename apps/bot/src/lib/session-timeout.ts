const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

type SessionRecord<T> = {
  value: T;
  lastActivityAt: number;
};

export class ExpiringSessionStore<T> {
  private readonly sessions = new Map<string, SessionRecord<T>>();

  constructor(private readonly timeoutMs = DEFAULT_TIMEOUT_MS) {}

  set(key: string, value: T) {
    this.sessions.set(key, { value, lastActivityAt: Date.now() });
  }

  get(key: string) {
    const session = this.sessions.get(key);

    if (!session) return null;

    if (Date.now() - session.lastActivityAt > this.timeoutMs) {
      this.sessions.delete(key);
      return null;
    }

    session.lastActivityAt = Date.now();
    return session.value;
  }

  delete(key: string) {
    this.sessions.delete(key);
  }

  touch(key: string) {
    const session = this.sessions.get(key);

    if (!session) return false;

    if (Date.now() - session.lastActivityAt > this.timeoutMs) {
      this.sessions.delete(key);
      return false;
    }

    session.lastActivityAt = Date.now();
    return true;
  }

  cleanup() {
    const now = Date.now();

    for (const [key, session] of this.sessions.entries()) {
      if (now - session.lastActivityAt > this.timeoutMs) {
        this.sessions.delete(key);
      }
    }
  }
}

export const MENU_SESSION_TIMEOUT_MS = DEFAULT_TIMEOUT_MS;
