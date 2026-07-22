'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { resolveNotificationAuthor } = require('../src/resolve-author');

function createGithub({ authors, organizationEmails = {}, organizationError = null }) {
  return {
    graphql: async (query, variables) => {
      if (query.includes('query CommitAuthors')) {
        return {
          repository: {
            object: {
              authors: {
                nodes: authors.map(({ email, login, name }) => ({
                  email,
                  name,
                  user: login ? { login } : null,
                })),
              },
            },
          },
        };
      }

      if (organizationError) {
        throw organizationError;
      }

      return {
        user: {
          organizationVerifiedDomainEmails: organizationEmails[variables.login] ?? [],
        },
      };
    },
    rest: {
      users: {
        getByUsername: async ({ username }) => ({
          data: { email: null, login: username, name: username },
        }),
      },
    },
  };
}

function createSlackFetch(usersByEmail, requestedEmails) {
  return async (url) => {
    const email = new URL(url).searchParams.get('email');
    requestedEmails.push(email);
    const user = usersByEmail[email];
    return {
      json: async () =>
        user
          ? { ok: true, user }
          : { ok: false, error: 'users_not_found' },
    };
  };
}

function createContext() {
  return {
    actor: 'workflow-actor',
    payload: {},
    repo: { owner: '514-labs', repo: 'ax' },
    sha: 'deadbeef',
  };
}

function createLogger() {
  return {
    warning: () => {},
  };
}

test('resolves a human author through their organization-verified email', async () => {
  const requestedEmails = [];
  const result = await resolveNotificationAuthor({
    context: createContext(),
    fetchImpl: createSlackFetch(
      {
        'lucio+github@fiveonefour.com': {
          id: 'U_LUCIO',
          is_app_user: false,
          is_bot: false,
          deleted: false,
        },
      },
      requestedEmails,
    ),
    github: createGithub({
      authors: [
        {
          email: 'luciofranco14@gmail.com',
          login: 'LucioFranco',
          name: 'Lucio Franco',
        },
        {
          email: 'noreply@anthropic.com',
          login: 'claude',
          name: 'Claude Fable 5',
        },
      ],
      organizationEmails: {
        LucioFranco: ['lucio+github@fiveonefour.com'],
      },
    }),
    logger: createLogger(),
    organization: '514-labs',
    slackBotToken: 'test-token',
  });

  assert.deepEqual(result, {
    githubLogin: 'LucioFranco',
    name: 'Lucio Franco',
    slackUserId: 'U_LUCIO',
  });
  assert.deepEqual(requestedEmails, ['lucio+github@fiveonefour.com']);
});

test('skips automated co-authors and resolves the first human Slack user', async () => {
  const requestedEmails = [];
  const result = await resolveNotificationAuthor({
    context: createContext(),
    fetchImpl: createSlackFetch(
      {
        'nicolas@fiveonefour.com': {
          id: 'U_NICOLAS',
          is_app_user: false,
          is_bot: false,
          deleted: false,
        },
      },
      requestedEmails,
    ),
    github: createGithub({
      authors: [
        {
          email: '291100569+514-admin[bot]@users.noreply.github.com',
          login: '514-admin[bot]',
          name: '514-admin[bot]',
        },
        {
          email: 'bot@fiveonefour.com',
          login: 'fiveonefour-github-bot',
          name: 'bot-1784',
        },
        {
          email: 'noreply@anthropic.com',
          login: 'claude',
          name: 'Claude Opus 4.8',
        },
        {
          email: 'nicolas@fiveonefour.com',
          login: 'callicles',
          name: 'Nicolas Joseph',
        },
      ],
      organizationEmails: {
        callicles: ['nicolas@fiveonefour.com'],
      },
    }),
    logger: createLogger(),
    organization: '514-labs',
    slackBotToken: 'test-token',
  });

  assert.equal(result.slackUserId, 'U_NICOLAS');
  assert.equal(result.githubLogin, 'callicles');
  assert.deepEqual(requestedEmails, ['nicolas@fiveonefour.com']);
});

test('continues past a Slack bot account to the next human author', async () => {
  const requestedEmails = [];
  const result = await resolveNotificationAuthor({
    context: createContext(),
    fetchImpl: createSlackFetch(
      {
        'automation@fiveonefour.com': {
          id: 'U_AUTOMATION',
          is_app_user: false,
          is_bot: true,
          deleted: false,
        },
        'nicolas@fiveonefour.com': {
          id: 'U_NICOLAS',
          is_app_user: false,
          is_bot: false,
          deleted: false,
        },
      },
      requestedEmails,
    ),
    github: createGithub({
      authors: [
        {
          email: 'automation@example.com',
          login: 'release-service',
          name: 'Release Service',
        },
        {
          email: 'nicolas@nicolasjoseph.com',
          login: 'callicles',
          name: 'Nicolas Joseph',
        },
      ],
      organizationEmails: {
        'release-service': ['automation@fiveonefour.com'],
        callicles: ['nicolas@fiveonefour.com'],
      },
    }),
    logger: createLogger(),
    organization: '514-labs',
    slackBotToken: 'test-token',
  });

  assert.equal(result.slackUserId, 'U_NICOLAS');
  assert.deepEqual(requestedEmails, [
    'automation@fiveonefour.com',
    'automation@example.com',
    'nicolas@fiveonefour.com',
  ]);
});

test('falls back to the commit email when organization email access is unavailable', async () => {
  const requestedEmails = [];
  const warnings = [];
  const result = await resolveNotificationAuthor({
    context: createContext(),
    fetchImpl: createSlackFetch(
      {
        'nicolas@fiveonefour.com': {
          id: 'U_NICOLAS',
          is_app_user: false,
          is_bot: false,
          deleted: false,
        },
      },
      requestedEmails,
    ),
    github: createGithub({
      authors: [
        {
          email: 'nicolas@fiveonefour.com',
          login: 'callicles',
          name: 'Nicolas Joseph',
        },
      ],
      organizationError: new Error('insufficient scopes'),
    }),
    logger: { warning: (message) => warnings.push(message) },
    organization: '514-labs',
    slackBotToken: 'test-token',
  });

  assert.equal(result.slackUserId, 'U_NICOLAS');
  assert.deepEqual(requestedEmails, ['nicolas@fiveonefour.com']);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /organization member access/);
});

test('returns a GitHub identity instead of an invalid Slack mention when no user matches', async () => {
  const requestedEmails = [];
  const result = await resolveNotificationAuthor({
    context: createContext(),
    fetchImpl: createSlackFetch({}, requestedEmails),
    github: createGithub({
      authors: [
        {
          email: 'luciofranco14@gmail.com',
          login: 'LucioFranco',
          name: 'Lucio Franco',
        },
      ],
      organizationEmails: {
        LucioFranco: ['lucio+github@fiveonefour.com'],
      },
    }),
    logger: createLogger(),
    organization: '514-labs',
    slackBotToken: 'test-token',
  });

  assert.deepEqual(result, {
    githubLogin: 'LucioFranco',
    name: 'Lucio Franco',
    slackUserId: null,
  });
  assert.deepEqual(requestedEmails, [
    'lucio+github@fiveonefour.com',
    'luciofranco14@gmail.com',
  ]);
});
