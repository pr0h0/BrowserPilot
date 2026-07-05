import { eq } from "drizzle-orm";
import { DEFAULT_BLOCKED_SITES, domainMatches, type SitePermission } from "@browserpilot/protocol";
import { db, schema } from "../db/client.js";
import { config } from "../config.js";
import { now } from "../util/ids.js";

export type SiteMode = "always" | "blocked" | "ask";

const blocklist = () => [...DEFAULT_BLOCKED_SITES, ...config.blockedSites];

/** Effective permission for a domain: config/DB blocklist wins, then DB "always", else "ask". */
export function getSiteMode(domain: string): SiteMode {
  if (!domain) return "ask";
  if (blocklist().some((p) => domainMatches(domain, p))) return "blocked";
  const row = db.select().from(schema.sitePermissions).where(eq(schema.sitePermissions.domain, domain)).get();
  return (row?.mode as SiteMode) ?? "ask";
}

export function listSitePermissions() {
  const rows = db.select().from(schema.sitePermissions).all();
  return {
    configured: rows.map((r) => ({ domain: r.domain, mode: r.mode, updatedAt: r.updatedAt })),
    blockedByConfig: blocklist(),
  };
}

export function setSitePermission(p: SitePermission) {
  const existing = db.select().from(schema.sitePermissions).where(eq(schema.sitePermissions.domain, p.domain)).get();
  if (existing) db.update(schema.sitePermissions).set({ mode: p.mode, updatedAt: now() }).where(eq(schema.sitePermissions.domain, p.domain)).run();
  else db.insert(schema.sitePermissions).values({ domain: p.domain, mode: p.mode, updatedAt: now() }).run();
  return { domain: p.domain, mode: p.mode };
}

export function deleteSitePermission(domain: string) {
  db.delete(schema.sitePermissions).where(eq(schema.sitePermissions.domain, domain)).run();
  return { domain, mode: "ask" as const };
}
