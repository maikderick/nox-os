import { randomUUID } from "node:crypto";

import { prisma } from "@/lib/db";
import { siteBriefSchema } from "@/lib/site-factory/brief-schema";
import { briefFactsHash } from "@/lib/site-factory/brief-service";
import { permissionsForRole } from "@/lib/authz/permissions";
import type { Actor } from "@/lib/authz/dal";

import { BRIEF_V2_INPUT } from "./provisioning-fixtures";

/**
 * A project the generation chain would actually accept.
 *
 * Provisioned all the way through — repository protected, hosting linked — and
 * with a v2 brief produced by the same schema the application uses, so a test
 * cannot pass against a fixture the real preflight would refuse.
 *
 * Every id carries a token so suites can run against one database without
 * colliding, and so a failure names the row it is about.
 */

export type GenerationFixture = {
  token: string;
  actor: Actor;
  organizationId: string;
  userId: string;
  clientId: string;
  siteProjectId: string;
  briefVersionId: string;
  repository: { owner: string; name: string };
  hostingProjectName: string;
  /** A second organization, for the questions that only a stranger can ask. */
  otherOrganizationId: string;
  otherActor: Actor;
};

export type FixtureOptions = {
  /** Starting state of the project. `BRIEFING_PRONTO` unless told otherwise. */
  status?: string;
  /** Cents. Null leaves the account without a price, which refuses generation. */
  generationPriceCents?: number | null;
  balanceCents?: number;
  monthlyCapCents?: number;
  /** Skips creating the credit account entirely. */
  withoutAccount?: boolean;
  /** Skips the repository, so the preflight has something to refuse. */
  withoutRepository?: boolean;
  withoutHosting?: boolean;
};

async function createOrganization(token: string, suffix: string) {
  const organization = await prisma.organization.create({
    data: { name: `Geracao ${suffix} ${token}`, slug: `geracao-${suffix}-${token}` },
  });
  const user = await prisma.user.create({
    data: {
      email: `dono-${suffix}-${token}@noxos.local`,
      name: `Dono ${suffix}`,
      passwordHash: "nao-usado-por-este-teste",
      role: "admin",
    },
  });
  const membership = await prisma.organizationMembership.create({
    data: { organizationId: organization.id, userId: user.id, role: "OWNER" },
  });

  const actor: Actor = {
    userId: user.id,
    email: user.email,
    name: user.name,
    organizationId: organization.id,
    organizationSlug: organization.slug,
    organizationName: organization.name,
    membershipId: membership.id,
    role: "OWNER",
    permissions: permissionsForRole("OWNER"),
  };

  return { organization, user, actor };
}

/**
 * Everything created since the last drop.
 *
 * A registry rather than a return value the suite has to remember, because
 * forgetting is the failure mode: a suite builds three or four fixtures across
 * its cases, and the one nobody tracked is the one whose `PENDENTE` job the next
 * suite's consumer picks up.
 */
const created: GenerationFixture[] = [];

export async function createGenerationFixture(
  options: FixtureOptions = {},
): Promise<GenerationFixture> {
  const token = randomUUID().slice(0, 8);

  const mine = await createOrganization(token, "a");
  const theirs = await createOrganization(token, "b");

  const client = await prisma.client.create({
    data: {
      organizationId: mine.organization.id,
      name: `Cliente ${token}`,
      slug: `cliente-${token}`,
    },
  });

  // Built by the application's own schema and hashing, so the fixture and the
  // gate cannot disagree about what a valid brief is.
  const brief = siteBriefSchema.parse(BRIEF_V2_INPUT);
  const contentJson = JSON.stringify(brief);

  const project = await prisma.siteProject.create({
    data: {
      organizationId: mine.organization.id,
      clientId: client.id,
      name: `Site ${token}`,
      slug: `site-${token}`,
      status: options.status ?? "BRIEFING_PRONTO",
    },
  });

  const briefVersion = await prisma.siteBriefVersion.create({
    data: {
      siteProjectId: project.id,
      version: 1,
      contentJson,
      factsHash: briefFactsHash(brief),
      createdById: mine.user.id,
    },
  });

  await prisma.siteProject.update({
    where: { id: project.id },
    data: { currentBriefVersionId: briefVersion.id },
  });

  const repository = { owner: "nox-sites", name: `site-${token}` };
  if (!options.withoutRepository) {
    await prisma.repository.create({
      data: {
        organizationId: mine.organization.id,
        siteProjectId: project.id,
        owner: repository.owner,
        name: repository.name,
        externalId: `repo_${token}`,
        url: `https://github.example/${repository.owner}/${repository.name}`,
        defaultBranch: "main",
        // The preflight requires this, not mere existence: an agent pointed at
        // an unprotected default branch makes the review optional.
        protectedAt: new Date(),
      },
    });
  }

  const hostingProjectName = `site-${token}`;
  if (!options.withoutHosting) {
    await prisma.hostingProject.create({
      data: {
        organizationId: mine.organization.id,
        siteProjectId: project.id,
        name: hostingProjectName,
        externalId: `prj_${token}`,
        url: `https://${hostingProjectName}.vercel.example`,
        linkedAt: new Date(),
      },
    });
  }

  if (!options.withoutAccount) {
    await prisma.creditAccount.create({
      data: {
        organizationId: mine.organization.id,
        balanceCents: options.balanceCents ?? 100_000,
        monthlyCapCents: options.monthlyCapCents ?? 100_000,
        generationPriceCents:
          options.generationPriceCents === undefined ? 1_500 : options.generationPriceCents,
      },
    });
  }

  // Every provider on `FALSO`. Without this the brake would pause every job,
  // which is correct behaviour and the wrong subject for these suites.
  await prisma.integrationSetting.createMany({
    data: ["github", "vercel", "cursor"].map((provider) => ({
      organizationId: mine.organization.id,
      provider,
      mode: "FALSO",
    })),
  });

  const fixture: GenerationFixture = {
    token,
    actor: mine.actor,
    organizationId: mine.organization.id,
    userId: mine.user.id,
    clientId: client.id,
    siteProjectId: project.id,
    briefVersionId: briefVersion.id,
    repository,
    hostingProjectName,
    otherOrganizationId: theirs.organization.id,
    otherActor: theirs.actor,
  };
  created.push(fixture);
  return fixture;
}

/**
 * Removes everything a fixture created.
 *
 * **Not optional, and not tidiness.** `claimJob` takes the oldest due job in
 * the *whole table* — there is one queue and any consumer may serve any tenant,
 * which is the design — so a `PENDENTE` job left behind by this suite is a job
 * the next suite's consumer will pick up and be baffled by. The same goes for
 * the ledger: an unscoped `count()` elsewhere would answer with our rows.
 *
 * Cascades from `Organization` reach `Job`, `SiteProject`, `GenerationRun`,
 * `SiteRevision`, `CreditAccount` and everything hanging off them; the two
 * users are deleted separately because they are not owned by an organization.
 * `Deployment.siteRevisionId` is `Restrict`, so deployments go first — a
 * cascade cannot be relied on to order itself around a restrict.
 */
export async function dropGenerationFixture(fixture: GenerationFixture): Promise<void> {
  await prisma.deployment.deleteMany({
    where: { siteProject: { organizationId: fixture.organizationId } },
  });
  await prisma.organization.deleteMany({
    where: { id: { in: [fixture.organizationId, fixture.otherOrganizationId] } },
  });
  await prisma.user.deleteMany({ where: { email: { contains: fixture.token } } });
}

/**
 * Drops everything created since the last call, newest first.
 *
 * Call it from `afterEach`. Suites build more than one fixture per case — a
 * second organization to ask a cross-tenant question, a third with no price —
 * and each of them leaves queue rows behind.
 */
export async function dropCreatedGenerationFixtures(): Promise<void> {
  const pending = created.splice(0, created.length).reverse();
  for (const fixture of pending) {
    await dropGenerationFixture(fixture);
  }
}

/** Creates the run and its `generation.start` job the way the route would. */
export async function requestFor(fixture: GenerationFixture, key = randomUUID()) {
  const { requestGeneration } = await import("@/lib/generation/request");
  return requestGeneration({
    actor: fixture.actor,
    siteProjectId: fixture.siteProjectId,
    idempotencyKey: key,
  });
}

/**
 * Registers the repository and the hosting project in the fake providers'
 * world, so the observers have something to observe.
 *
 * Kept out of `createGenerationFixture` on purpose: the database rows and the
 * simulated remote world are two different things, and a suite about the
 * preflight should be able to have the first without the second.
 */
export async function provisionFakeWorld(fixture: GenerationFixture) {
  const { sharedFakeWorld, repoKey } = await import("@/lib/providers/fake/fake-world");

  sharedFakeWorld.repositories.set(repoKey(fixture.repository.owner, fixture.repository.name), {
    owner: fixture.repository.owner,
    name: fixture.repository.name,
    externalId: `repo_${fixture.token}`,
    url: `https://github.example/${fixture.repository.owner}/${fixture.repository.name}`,
    defaultBranch: "main",
    templateRepository: { owner: "maikderick", name: "nox-site-template" },
    protectedChecks: ["verify"],
    files: new Map(),
    commits: [],
    checks: new Map(),
  });

  sharedFakeWorld.projects.set(fixture.hostingProjectName, {
    externalId: `prj_${fixture.token}`,
    name: fixture.hostingProjectName,
    url: `https://${fixture.hostingProjectName}.vercel.example`,
    repoKey: repoKey(fixture.repository.owner, fixture.repository.name),
    envVars: new Map(),
    deployments: [],
  });
}
