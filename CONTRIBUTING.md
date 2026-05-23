# Contributing to Astropods Agents

Thanks for your interest in contributing to the `astropods/agents` repository — the home of pre-built agents you can run with the Astropods CLI (`ast`). This document outlines the process for contributing and provides specific guidance for code contributions.

---

## Issues

The easiest way to contribute is to open an issue with a bug report or a suggestion for improvement. We do not have a prescriptive issue template. We merely request that you take the time to communicate clearly so that we can understand what is being requested and respond appropriately.

- For bug reports, give as much detail as you can about exactly what you were doing when the problem occurred and use transcripts or screenshots to show the problematic behavior. Include the agent you were running, the `ast` version (`ast --version`), and your platform.
- For enhancement requests, give the context. Ideally, explain why the Astropods community would be interested in the improvement. Then, be as explicit as you can about how you see the change looking and behaving.
- Check other open issues and add comments to existing issues rather than creating duplicates.

---

## How to contribute

1. **Fork** the repository
2. **Create a branch** for your changes
3. **Add or update an agent** — each agent lives in its own directory with an `astropods.yml` spec
4. **Open a pull request** with a description of your agent and how to run it

---

## Contributions of source code

All such contributions should be in the form of pull requests. The exact format of the pull request description is not important but it should include

- _motivation_: what problem the contribution is trying to solve and why it should be regarded as helpful
- _externals_: what visible changes to the behavior of an agent (or to `ast` workflows) will occur if the pull request is merged
- (optionally) _internals_: anything that will help orient a reviewer in reading the code.

By opening a pull request

- You agree that your contributions will be licensed under the [Apache 2.0 License](LICENSE).
- When you open a pull request with your contributions, **you are certifying that you wrote the code** in the corresponding patch pursuant to the [Developer Certificate of Origin](#developer-certificate-of-origin) included below for your reference.
- You must conform to the style and validation rules for the agent you are touching. Before submitting:
  - Run `ast spec validate` against any `astropods.yml` you have changed.
  - For TypeScript / Bun agents, run the agent's `lint` / `typecheck` scripts (e.g. `bun run lint`, `bun run typecheck`).
  - For Python agents, run the agent's configured formatter and linter (e.g. `ruff check`, `ruff format`).
  - Verify the agent still starts with `ast dev` from its directory.

### Adding a new agent

- Create a new top-level directory (e.g. `my-agent/`) containing the agent's source.
- Add an `astropods.yml` spec describing the agent's containers, interfaces, models, knowledge, and inputs.
- Include an `AGENT.md` (see the [agent-card skill](skills/agent-card.md)) and a `README.md` covering setup, required secrets, and how to run it.
- Add the agent to the table in the top-level [`README.md`](README.md).

---

## Contact us

We're always happy to help you with any issues you encounter. The best place to reach us is by opening an issue or discussion in this repository. For platform-level questions, see the docs at <https://docs.astropods.com>.

---

## Developer Certificate of Origin

```
Developer Certificate of Origin
Version 1.1

Copyright (C) 2004, 2006 The Linux Foundation and its contributors.
1 Letterman Drive
Suite D4700
San Francisco, CA, 94129

Everyone is permitted to copy and distribute verbatim copies of this
license document, but changing it is not allowed.


Developer's Certificate of Origin 1.1

By making a contribution to this project, I certify that:

(a) The contribution was created in whole or in part by me and I
    have the right to submit it under the open source license
    indicated in the file; or

(b) The contribution is based upon previous work that, to the best
    of my knowledge, is covered under an appropriate open source
    license and I have the right under that license to submit that
    work with modifications, whether created in whole or in part
    by me, under the same open source license (unless I am
    permitted to submit under a different license), as indicated
    in the file; or

(c) The contribution was provided directly to me by some other
    person who certified (a), (b) or (c) and I have not modified
    it.

(d) I understand and agree that this project and the contribution
    are public and that a record of the contribution (including all
    personal information I submit with it, including my sign-off) is
    maintained indefinitely and may be redistributed consistent with
    this project or the open source license(s) involved.
```
