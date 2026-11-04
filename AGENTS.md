# Repository instructions

## Product context

Read [PRODUCT.md](PRODUCT.md) before starting work in this repository. Use it to guide product and implementation decisions.

## Commits and pull requests

Use [Conventional Commits](https://www.conventionalcommits.org/) for every commit message and every pull request title. This applies to each commit you make, not only the squash-merge title, and to cloud agents as much as local ones.

- Write each on a single line in the form `type(scope): description`, such as `feat(api): log workflow jobs that ask for the relayrunner label` or `chore: scaffold pnpm workspace`.
- Use one of these types: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, or `revert`.
- The scope is optional. When you use one, name the app or package, such as `api`, `web`, `webhooks`, `cli`, or `landing`.
- Write the description in the imperative mood and in lowercase, with no trailing period.
- Mark a breaking change with `!` after the type or scope, such as `feat(api)!: …`.

## Formatting and checks

Format with oxfmt (`pnpm format`) and lint with Oxlint (`pnpm lint`). Run `pnpm check` before you push; CI runs the same command. The pre-commit hook formats and lints staged files, so don't skip it with `--no-verify`.

## Preview URLs and dev-only views

Dashboard preview URLs and `/dev/*` views sit behind Cloudflare Access. To reach them, send the `CF-Access-Client-Id` and `CF-Access-Client-Secret` headers from `CF_ACCESS_CLIENT_ID` and `CF_ACCESS_CLIENT_SECRET`. `GET /dev/access` confirms the token works. See [docs/cloudflare-access.md](docs/cloudflare-access.md).
