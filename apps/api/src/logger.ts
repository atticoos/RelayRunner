// Structured logging for the API Worker and its Durable Objects, built on LogTape.
//
// Every line is written as one object with the matching console method, so Workers Logs indexes
// each field and the dashboard's query builder can filter on them (component, event, requestId...).
// Workers Logs already records which Worker and Durable Object class a line came from, so
// `component` only names the part of our code.
//
// Usage:
//   const log = logger('webhooks.github').with({ deliveryId });
//   log.info('webhook.received', { repo });
//
// The message is the `event`: a stable, dotted name to filter and count on. Put detail in fields.
// Fields set with `withContext` (the request middleware sets `requestId`) are added to every line
// written while that request runs. Durable Object calls are separate invocations, so pass
// `requestId` and other ids to them explicitly.
import { AsyncLocalStorage } from 'node:async_hooks';
import { configureSync, getLogger, type Logger, type LogLevel, type LogRecord } from '@logtape/logtape';

// The parts of the system a log line can belong to. Keep this a closed list: a new area of the code
// gets a new entry here, which makes typos impossible and keeps the list a map of the system.
export type Component =
  | 'http' // one line per request, from the request middleware
  | 'auth' // sign-in, sessions, Better Auth hooks
  | 'webhooks.github' // GitHub App deliveries: received, signature, dispatch
  | 'github.api' // our outgoing calls to GitHub
  | 'do.router'
  | 'do.pick-runner'
  | 'do.machine-link'
  | 'db'; // D1: errors and slow queries only

const root = 'relayrunner';

// LogTape categories are paths, so `webhooks.github` is ['relayrunner', 'webhooks', 'github'] and
// config can target a whole area (e.g. everything under 'do').
export function logger(component: Component): Logger {
  return getLogger([root, ...component.split('.')]);
}

let configured = false;

// Call once per isolate before logging: from the request middleware and Durable Object constructors.
// LOG_LEVEL is debug | info | warn | error and defaults to info.
export function setupLogging(env: { LOG_LEVEL?: string }) {
  if (configured) return;
  configured = true;
  configureSync({
    sinks: { workers: workersSink },
    loggers: [
      { category: [root], lowestLevel: toLogLevel(env.LOG_LEVEL), sinks: ['workers'] },
      { category: ['logtape', 'meta'], lowestLevel: 'warning', sinks: ['workers'] },
    ],
    contextLocalStorage: new AsyncLocalStorage(),
  });
}

function toLogLevel(value: string | undefined): LogLevel {
  switch (value) {
    case 'debug':
      return 'debug';
    case 'warn':
      return 'warning';
    case 'error':
      return 'error';
    default:
      return 'info';
  }
}

const write: Record<LogLevel, (line: unknown) => void> = {
  trace: line => console.debug(line),
  debug: line => console.debug(line),
  info: line => console.log(line),
  warning: line => console.warn(line),
  error: line => console.error(line),
  fatal: line => console.error(line),
};

// Writes a plain object (not a string) so Workers Logs indexes every field.
function workersSink(record: LogRecord) {
  write[record.level](formatRecord(record));
}

export function formatRecord(record: LogRecord) {
  const line: Record<string, unknown> = {
    level: record.level === 'warning' ? 'warn' : record.level,
    event: record.message.map(String).join(''),
    component: record.category[0] === root ? record.category.slice(1).join('.') : record.category.join('.'),
  };
  for (const [key, value] of Object.entries(record.properties)) {
    // Errors don't survive serialization, so keep their name, message and stack.
    line[key] = value instanceof Error ? { name: value.name, message: value.message, stack: value.stack } : value;
  }
  return line;
}
