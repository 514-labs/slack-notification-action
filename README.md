# slack-notification-action

GitHub action for notifying Slack when a build fails.

The action identifies the first human commit author who has an active Slack account. It reads GitHub's complete commit author list (including `Co-authored-by` trailers), checks each author's email verified against the repository owner's organization, and uses Slack's `users.lookupByEmail` API to create a mention. Automated authors and Slack bot users are skipped.

## Usage

```yaml
- name: Notify Slack on failure
  uses: 514-labs/slack-notification-action@1.2.0
  with:
    slack-bot-token: ${{ secrets.SLACK_BOT_TOKEN }}
    slack-webhook-url: ${{ secrets.SLACK_GITHUB_ACTIONS_WEBHOOK_URL }}
    github-token: ${{ secrets.SLACK_AUTHOR_LOOKUP_GITHUB_TOKEN }}
```

`github-token` should be a GitHub App installation token with organization **Members: read** access, or another token allowed to read organization-verified domain emails. Without that access, the action falls back to the emails recorded on the commit. The workflow's default `GITHUB_TOKEN` is used when the input is omitted.

For repositories whose owner is not the organization that verifies employee email addresses, set `github-organization` explicitly:

```yaml
with:
  github-organization: 514-labs
```

The Slack bot token needs `users:read.email` to resolve email addresses to Slack member IDs.
