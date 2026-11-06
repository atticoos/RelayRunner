import { describe, expect, test } from "vitest";
import { checksPullRequestTitles, prTitleCheckRun } from "./pr-title-check.ts";

describe("checksPullRequestTitles", () => {
  test("matches listed repos, ignoring case and spaces", () => {
    expect(checksPullRequestTitles("relayrunner/relayrunner", "RelayRunner/relayrunner")).toBe(
      true,
    );
    expect(checksPullRequestTitles(" acme/app , relayrunner/relayrunner", "acme/app")).toBe(true);
    expect(checksPullRequestTitles("relayrunner/relayrunner", "acme/app")).toBe(false);
    expect(checksPullRequestTitles(undefined, "acme/app")).toBe(false);
    expect(checksPullRequestTitles("", "acme/app")).toBe(false);
  });
});

describe("prTitleCheckRun", () => {
  test("passes a Conventional Commit title", () => {
    expect(prTitleCheckRun("feat(api): add checks", "abc")).toEqual({
      name: "PR title",
      headSha: "abc",
      conclusion: "success",
      title: "Conventional Commit title",
      summary: '"feat(api): add checks" is a Conventional Commit.',
    });
  });

  test("fails any other title with how to fix it", () => {
    const check = prTitleCheckRun("Add checks", "abc");
    expect(check.conclusion).toBe("failure");
    expect(check.summary).toContain("Write it as type(scope): description");
  });
});
