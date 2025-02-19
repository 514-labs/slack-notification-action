# slack-notification-action
github action for notifying slack when a build fails

leverages: https://github.com/marketplace/actions/slack-notify

```yaml
name: Notify Slack on failure
uses: 514-labs/slack-notification-action@1.0.0
with:
  slack-bot-token: ${{ secrets.SLACK_BOT_TOKEN }}
  slack-webhook-url: ${{ secrets.SLACK_GITHUB_ACTIONS_WEBHOOK_URL }}
```