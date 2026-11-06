// The "PR title" check: the GitHub App posts a check run on each pull request saying whether its
// title is a Conventional Commit. No runner and no workflow, so it works on public repos and costs
// no Actions minute. Only repos listed in PR_TITLE_CHECK_REPOS get it for now.

import type { WebhookMessage } from "@relayrunner/github-webhooks";
import type { Env } from "./env.ts";
import { appJwt, createCheckRun, importAppPrivateKey, installationToken } from "./github-app.ts";
import { checkConventionalTitle } from "./native-checks.ts";

export const PR_TITLE_CHECK_NAME = "PR title";

type PullRequestMessage = Extract<WebhookMessage, { event: "pull_request" }>;

/** Whether `repo` is in the comma-separated PR_TITLE_CHECK_REPOS list. GitHub ignores case. */
export function checksPullRequestTitles(list: string | undefined, repo: string) {
  return (list ?? "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .includes(repo.toLowerCase());
}

/** The check run for a title: a pass, or a failure that says how to fix it. */
export function prTitleCheckRun(title: string, headSha: string) {
  const result = checkConventionalTitle(title);
  return {
    name: PR_TITLE_CHECK_NAME,
    headSha,
    conclusion: result.ok ? ("success" as const) : ("failure" as const),
    title: result.ok ? "Conventional Commit title" : "Not a Conventional Commit title",
    summary: result.ok ? `"${title}" is a Conventional Commit.` : result.reason,
  };
}

/** Posts the check run for a pull request that opened, changed its title or got new commits. */
export async function checkPullRequestTitle(env: Env, message: PullRequestMessage) {
  const repo = message.repository.fullName;
  if (!message.installationId || !checksPullRequestTitles(env.PR_TITLE_CHECK_REPOS, repo)) return;
  const key = await importAppPrivateKey(await env.GITHUB_APP_PRIVATE_KEY.get());
  const token = await installationToken(
    await appJwt(env.GITHUB_APP_ID, key),
    message.installationId,
  );
  const check = prTitleCheckRun(message.pullRequest.title, message.pullRequest.headSha);
  await createCheckRun(token, repo, check);
  console.log(
    JSON.stringify({
      msg: "relayrunner pr title checked",
      deliveryId: message.deliveryId,
      repository: repo,
      pullRequest: message.pullRequest.number,
      conclusion: check.conclusion,
    }),
  );
}
