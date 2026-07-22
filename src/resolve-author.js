'use strict';

const COMMIT_AUTHORS_QUERY = `
  query CommitAuthors($owner: String!, $repo: String!, $oid: GitObjectID!) {
    repository(owner: $owner, name: $repo) {
      object(oid: $oid) {
        ... on Commit {
          authors(first: 50) {
            nodes {
              email
              name
              user {
                login
              }
            }
          }
        }
      }
    }
  }
`;

const ORGANIZATION_EMAILS_QUERY = `
  query OrganizationEmails($login: String!, $organization: String!) {
    user(login: $login) {
      organizationVerifiedDomainEmails(login: $organization)
    }
  }
`;

function isObviousAutomation(author) {
  const login = author.login.toLowerCase();
  const name = author.name.toLowerCase();
  const email = author.email.toLowerCase();

  return (
    login.endsWith('[bot]') ||
    login.endsWith('-bot') ||
    name.startsWith('bot-') ||
    email === 'noreply@anthropic.com'
  );
}

function uniqueEmails(emails) {
  const seen = new Set();
  return emails.filter((email) => {
    const normalized = email.trim().toLowerCase();
    if (!normalized || seen.has(normalized)) {
      return false;
    }
    seen.add(normalized);
    return true;
  });
}

async function getCommitAuthors({ github, context, logger }) {
  try {
    const result = await github.graphql(COMMIT_AUTHORS_QUERY, {
      owner: context.repo.owner,
      repo: context.repo.repo,
      oid: context.sha,
    });

    const nodes = result.repository?.object?.authors?.nodes ?? [];
    return nodes.map((author) => ({
      email: author.email ?? '',
      login: author.user?.login ?? '',
      name: author.name ?? '',
    }));
  } catch (error) {
    logger.warning(`Could not read commit authors from GitHub: ${error.message}`);
    return [];
  }
}

async function getFallbackAuthor({ github, context }) {
  const eventAuthor = context.payload?.head_commit?.author;
  if (eventAuthor) {
    return {
      email: eventAuthor.email ?? '',
      login: eventAuthor.username ?? context.actor ?? '',
      name: eventAuthor.name ?? context.actor ?? '',
    };
  }

  if (!context.actor) {
    return { email: '', login: '', name: 'unknown' };
  }

  try {
    const { data } = await github.rest.users.getByUsername({
      username: context.actor,
    });
    return {
      email: data.email ?? '',
      login: data.login ?? context.actor,
      name: data.name ?? data.login ?? context.actor,
    };
  } catch {
    return { email: '', login: context.actor, name: context.actor };
  }
}

async function lookupSlackUser({ email, fetchImpl, slackBotToken, logger }) {
  try {
    const response = await fetchImpl(
      `https://slack.com/api/users.lookupByEmail?email=${encodeURIComponent(email)}`,
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${slackBotToken}`,
          'Content-Type': 'application/json',
        },
      },
    );
    const data = await response.json();

    if (!data.ok || !data.user) {
      if (data.error !== 'users_not_found') {
        logger.warning(`Slack user lookup failed: ${data.error ?? 'unknown_error'}`);
      }
      return null;
    }

    if (data.user.deleted || data.user.is_bot || data.user.is_app_user) {
      return null;
    }

    return data.user.id;
  } catch (error) {
    logger.warning(`Slack user lookup failed: ${error.message}`);
    return null;
  }
}

async function resolveNotificationAuthor({
  github,
  context,
  fetchImpl,
  slackBotToken,
  organization,
  logger = { warning: console.warn },
}) {
  let authors = await getCommitAuthors({ github, context, logger });
  if (authors.length === 0) {
    authors = [await getFallbackAuthor({ github, context })];
  }

  const humanCandidates = authors.filter((author) => !isObviousAutomation(author));
  const candidates = humanCandidates.length > 0 ? humanCandidates : authors;
  let organizationEmailLookupAvailable = true;

  for (const author of candidates) {
    let organizationEmails = [];

    if (organizationEmailLookupAvailable && author.login && organization) {
      try {
        const result = await github.graphql(ORGANIZATION_EMAILS_QUERY, {
          login: author.login,
          organization,
        });
        organizationEmails = result.user?.organizationVerifiedDomainEmails ?? [];
      } catch (error) {
        organizationEmailLookupAvailable = false;
        logger.warning(
          `Could not read organization-verified GitHub emails; ` +
            `provide a GitHub token with organization member access: ${error.message}`,
        );
      }
    }

    const emails = uniqueEmails([...organizationEmails, author.email]);
    for (const email of emails) {
      const slackUserId = await lookupSlackUser({
        email,
        fetchImpl,
        slackBotToken,
        logger,
      });
      if (slackUserId) {
        return {
          githubLogin: author.login,
          name: author.name,
          slackUserId,
        };
      }
    }
  }

  const fallback = candidates[0] ?? {
    login: context.actor ?? '',
    name: context.actor ?? 'unknown',
  };
  return {
    githubLogin: fallback.login,
    name: fallback.name,
    slackUserId: null,
  };
}

module.exports = {
  resolveNotificationAuthor,
};
