# Triage Labels

The skills speak in terms of five canonical triage roles. This file maps those roles to the actual label strings used in this repo's issue tracker (GitHub Issues, repo `Zewang0217/cyber-stray`).

| Label in mattpocock/skills | Label in our tracker | Meaning                                  |
| -------------------------- | -------------------- | ---------------------------------------- |
| `needs-triage`             | `needs-triage`       | Maintainer needs to evaluate this issue  |
| `needs-info`               | `needs-info`         | Waiting on reporter for more information |
| `ready-for-agent`          | `ready-for-agent`    | Fully specified, ready for an AFK agent  |
| `ready-for-human`          | `ready-for-human`    | Requires human implementation            |
| `wontfix`                  | `wontfix`            | Will not be actioned                     |

When a skill mentions a role (e.g. "apply the AFK-ready triage label"), use the corresponding label string from this table.

## Existing repo labels

`wontfix` already exists on the GitHub repo. The other four (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`) do not yet exist — create them lazily when first applied (e.g. `gh label create needs-triage --description "Maintainer needs to evaluate this issue"`), or let `/triage` create them on first run.

The repo also carries topic labels that are orthogonal to triage state — `bug`, `enhancement`, `documentation`, `design`, `discussion`, `epic`, `saas`, `高优先级`, `重要`, `低优先级`, `help wanted`, `good first issue`, `question`, `duplicate`, `invalid`. These coexist with the triage labels and are not part of the triage state machine.

## Editing this mapping

Edit the right-hand column to match whatever vocabulary you actually use. If you rename a label on GitHub, update both this table and the label string in `docs/agents/issue-tracker.md` flows.
