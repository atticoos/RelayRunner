/**
 * lint-staged config, run by the Husky pre-commit hook.
 *
 * Files under an `.oxfmtrc.json` ignorePattern are filtered out first: handing oxfmt a list
 * that is entirely ignored makes it exit non-zero ("Expected at least one target file").
 */

import path from "node:path";

// Repo-relative prefixes from `.oxfmtrc.json` ignorePatterns.
const OXFMT_IGNORED_DIRS = ["apps/api/migrations/meta/", "apps/landing/.impeccable/"];

const isIgnored = (file) => {
  const rel = path.relative(process.cwd(), file);
  return (
    OXFMT_IGNORED_DIRS.some((dir) => rel.startsWith(dir)) ||
    rel.endsWith(".d.ts") ||
    rel.endsWith(".gen.ts")
  );
};

const oxfmtCommand = (stagedFiles) => {
  const formattable = stagedFiles.filter((f) => !isIgnored(f));
  return formattable.length > 0
    ? [`oxfmt --no-error-on-unmatched-pattern --write ${formattable.join(" ")}`]
    : [];
};

export default {
  "*.{js,jsx,ts,tsx,mjs,cjs}": (stagedFiles) => [
    `oxlint --deny-warnings --no-error-on-unmatched-pattern ${stagedFiles.join(" ")}`,
    ...oxfmtCommand(stagedFiles),
  ],
  "*.{json,jsonc,md,yml,yaml,css,html,toml}": oxfmtCommand,
};
