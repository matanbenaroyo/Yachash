import fs from 'fs';
import path from 'path';

interface LogEntry {
  timestamp: string;
  level: 'log' | 'info' | 'warn' | 'error';
  message: string;
}

/** Keep this many days of log files; older ones are removed on startup. */
const LOG_RETENTION_DAYS = 7;

class Logger {
  private logs: LogEntry[] = [];
  private maxLogs = 1000; // Keep last 1000 logs

  /**
   * Log file for today, or null until a destination is set.
   *
   * Memory-only logging meant every restart erased the evidence, so a failure
   * could only be investigated while it was still happening — and a bot that
   * stops receiving messages gives no sign at the moment it happens. Writing to
   * disk is also the only way to diagnose anything once this runs on a host
   * with no screen attached.
   */
  private logFile: string | null = null;
  private pending: string[] = [];
  private flushTimer: NodeJS.Timeout | null = null;

  /**
   * Starts writing to `<dir>/log-YYYY-MM-DD.txt`.
   *
   * Called once userData is known — main.ts resolves that after the dev-mode
   * override, so it cannot be done in the constructor.
   */
  setLogDirectory(dir: string): void {
    try {
      fs.mkdirSync(dir, { recursive: true });
      this.logFile = path.join(dir, `log-${new Date().toISOString().slice(0, 10)}.txt`);
      // Anything logged before the directory was known still belongs in the file.
      const backlog = this.logs.map(e => `[${e.timestamp}] ${e.level.toUpperCase()}: ${e.message}`);
      this.pending.unshift(...backlog);
      this.scheduleFlush();
      this.pruneOldLogs(dir);
      this.log(`📝 Logging to ${this.logFile}`);
    } catch (error) {
      this.originalConsole.error('Could not open log file:', error);
    }
  }

  getLogFile(): string | null {
    return this.logFile;
  }

  /** Batches writes so a chatty startup does not mean thousands of syscalls. */
  private scheduleFlush(): void {
    if (this.flushTimer || !this.logFile) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      this.flush();
    }, 1000);
  }

  private flush(): void {
    if (!this.logFile || !this.pending.length) return;
    const chunk = this.pending.join('\n') + '\n';
    this.pending = [];
    try {
      fs.appendFileSync(this.logFile, chunk, 'utf8');
    } catch {
      // Losing a log line must never take the app down with it.
    }
  }

  /** Writes anything still buffered. Call before quitting. */
  flushSync(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    this.flush();
  }

  private pruneOldLogs(dir: string): void {
    try {
      const cutoff = Date.now() - LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000;
      for (const name of fs.readdirSync(dir)) {
        if (!/^log-\d{4}-\d{2}-\d{2}\.txt$/.test(name)) continue;
        const full = path.join(dir, name);
        if (fs.statSync(full).mtimeMs < cutoff) fs.unlinkSync(full);
      }
    } catch {
      // Retention is housekeeping; never let it block startup.
    }
  }
  private originalConsole = {
    log: console.log,
    info: console.info,
    warn: console.warn,
    error: console.error,
  };

  constructor() {
    this.interceptConsole();
  }

  private interceptConsole() {
    // Override console.log
    console.log = (...args: any[]) => {
      const message = args.map(arg => 
        typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)
      ).join(' ');
      
      this.addLog('log', message);
      this.originalConsole.log(...args);
    };

    // Override console.info
    console.info = (...args: any[]) => {
      const message = args.map(arg => 
        typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)
      ).join(' ');
      
      this.addLog('info', message);
      this.originalConsole.info(...args);
    };

    // Override console.warn
    console.warn = (...args: any[]) => {
      const message = args.map(arg => 
        typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)
      ).join(' ');
      
      this.addLog('warn', message);
      this.originalConsole.warn(...args);
    };

    // Override console.error
    console.error = (...args: any[]) => {
      const message = args.map(arg => {
        if (arg instanceof Error) {
          return `${arg.message}\n${arg.stack}`;
        }
        return typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg);
      }).join(' ');
      
      this.addLog('error', message);
      this.originalConsole.error(...args);
    };
  }

  private addLog(level: LogEntry['level'], message: string) {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
    };

    this.logs.push(entry);

    // Keep only last maxLogs entries
    if (this.logs.length > this.maxLogs) {
      this.logs = this.logs.slice(-this.maxLogs);
    }

    this.pending.push(`[${entry.timestamp}] ${entry.level.toUpperCase()}: ${entry.message}`);
    if (this.pending.length > 5000) this.flush(); // don't buffer without bound
    else this.scheduleFlush();
  }

  getLogs(): LogEntry[] {
    return [...this.logs];
  }

  clearLogs() {
    this.logs = [];
  }

  // Manual logging methods
  log(message: string) {
    console.log(message);
  }

  info(message: string) {
    console.info(message);
  }

  warn(message: string) {
    console.warn(message);
  }

  error(message: string) {
    console.error(message);
  }
}

// Export singleton instance
export const logger = new Logger();
