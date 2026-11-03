# RunnerDuty product definition

RunnerDuty helps developers reduce GitHub Actions minute usage during active development by running selected CI jobs on their own machine. When they're done, they can switch future jobs back to GitHub-hosted runners. Developers keep their usual push workflow and see the same checks and logs in GitHub Actions.

## User experience

- **Set up once.** An agent can inspect a repository, identify eligible jobs, preview the changes, and apply the setup. RunnerDuty handles runner registration and workflow configuration. The user can complete any required authorization without editing YAML or changing GitHub settings by hand.
- **Switch to local.** A developer can ask an agent to run the current branch's eligible jobs on their machine. RunnerDuty checks that the machine's runner is online before enabling the route.
- **Check status.** RunnerDuty reports the active route, the branch it applies to, and the local runner's availability.
- **Switch back.** A developer can ask an agent to restore GitHub-hosted execution for future jobs while any running local job finishes. RunnerDuty should make already-queued local jobs visible so users know which jobs need recovery.

## Product principles

- **Skill first, CLI available.** The skill translates user intent into CLI commands. The CLI owns setup, routing, and status, with readable output for people and structured output for agents.
- **One workflow change during setup.** Each opted-in job gets a routing rule in `runs-on`. Routine switches update repository-level Actions configuration and require no workflow edits or commits.
- **Keep hosted execution as the default.** Local routing applies to the active branch and selected jobs. Other jobs and branches use their existing runner configuration.
- **Make setup safe to retry.** Preview workflow changes and report missing access or runner prerequisites clearly. An interrupted setup should be resumable.

## First release

Start with one private repository, one developer machine, one active branch, and explicitly selected jobs triggered by pushes. Validate the full loop with one job. Run it on GitHub, switch to local and push again, then switch back and verify that the next push runs on GitHub under the same check name.
