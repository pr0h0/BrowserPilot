export { redactSensitiveData } from "@browserpilot/protocol";

import { redactSensitiveData } from "@browserpilot/protocol";
if (import.meta.main) {
  // ponytail: tiny self-check — fails loudly if redaction stops walking nested objects.
  const r = redactSensitiveData({ authorization: "Bearer x", nested: { cookie: "a=b", ok: 1 }, list: [{ token: "t" }] }) as any;
  if (r.authorization !== "[REDACTED]" || r.nested.cookie !== "[REDACTED]" || r.list[0].token !== "[REDACTED]" || r.nested.ok !== 1) {
    throw new Error("redaction self-check failed");
  }
  console.log("redaction ok");
}
