// Worker entry. The logic lives in ingress.ts: workerd only accepts handlers as module exports.
import { handleRequest, type Env } from "./ingress.ts";

export default { fetch: handleRequest } satisfies ExportedHandler<Env>;
