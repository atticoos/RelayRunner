// A repo's RelayRunner settings: `relayrunner.yml` in `.github/` or at the repo root, read from the
// default branch so a pull request can't change the checks it gets. The App can read only these
// two files (single-file Contents permission). No file means no checks.
//
//   checks:
//     pr-title: true            # or { types: [feat, fix, docs] } to narrow the allowed types

import { parse } from "yaml";
import { z } from "zod";
import { repoFile } from "./github-app.ts";

// The first one found wins.
export const CONFIG_PATHS = [".github/relayrunner.yml", "relayrunner.yml"] as const;

const typeList = z
  .union([z.array(z.string()), z.string()])
  .transform((value) =>
    (Array.isArray(value) ? value : value.split(/[,\n]/))
      .map((type) => type.trim())
      .filter(Boolean),
  );

const schema = z
  .object({
    checks: z
      .object({
        "pr-title": z
          .union([z.boolean(), z.object({ types: typeList.optional() }).strict()])
          .optional(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .nullable();

// `prTitle` is null when the check is off.
export type ConfigResult =
  | { kind: "none" }
  | { kind: "config"; path: string; prTitle: { types: string[] } | null }
  | { kind: "invalid"; path: string; error: string };

/** Parses a relayrunner.yml. An empty file is valid and turns everything off. */
export function parseRepoConfig(path: string, text: string): ConfigResult {
  let data: unknown;
  try {
    data = parse(text);
  } catch (error) {
    return { kind: "invalid", path, error: error instanceof Error ? error.message : String(error) };
  }
  const result = schema.safeParse(data ?? null);
  if (!result.success)
    return {
      kind: "invalid",
      path,
      error: result.error.issues
        .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
        .join("; "),
    };
  const prTitle = result.data?.checks?.["pr-title"];
  return {
    kind: "config",
    path,
    prTitle: !prTitle ? null : { types: prTitle === true ? [] : (prTitle.types ?? []) },
  };
}

/** The repo's config from its default branch. */
export async function loadRepoConfig(token: string, repo: string): Promise<ConfigResult> {
  for (const path of CONFIG_PATHS) {
    const text = await repoFile(token, repo, path);
    if (text !== null) return parseRepoConfig(path, text);
  }
  return { kind: "none" };
}
