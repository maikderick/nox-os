import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  count: vi.fn(),
  findMany: vi.fn(),
  findSettings: vi.fn(),
  getServerSession: vi.fn(),
}));

vi.mock("next-auth", () => ({ getServerSession: mocks.getServerSession }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/db", () => ({
  prisma: {
    business: {
      count: mocks.count,
      findMany: mocks.findMany,
    },
    appSettings: {
      findUnique: mocks.findSettings,
    },
  },
}));

import { GET } from "../../src/app/api/leads/route";
import { GET as GET_STATS } from "../../src/app/api/leads/stats/route";

function lead(id: string, website: string | null) {
  return {
    id,
    name: `Lead ${id}`,
    website,
    scoreReasons: "[]",
    socialLinks: "[]",
    consents: [],
  };
}

describe("GET /api/leads website eligibility", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getServerSession.mockResolvedValue({ user: { id: "user-1" } });
  });

  it("returns only leads without an owned website by default", async () => {
    mocks.findMany
      .mockResolvedValueOnce([
        { id: "without", website: null },
        { id: "owned", website: "https://empresa.com.br" },
        { id: "social", website: "https://instagram.com/empresa" },
      ])
      // Deliberately reverse the DB result: the route must restore candidate order.
      .mockResolvedValueOnce([lead("social", "https://instagram.com/empresa"), lead("without", null)]);

    const response = await GET(new Request("http://localhost/api/leads?pageSize=25"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.total).toBe(2);
    expect(body.items.map((item: { id: string }) => item.id)).toEqual(["without", "social"]);
    expect(mocks.count).not.toHaveBeenCalled();
  });

  it("includes owned websites only when explicitly requested", async () => {
    mocks.count.mockResolvedValue(3);
    mocks.findMany.mockResolvedValue([
      lead("without", null),
      lead("owned", "https://empresa.com.br"),
      lead("social", "https://instagram.com/empresa"),
    ]);

    const response = await GET(
      new Request("http://localhost/api/leads?includeWithWebsite=true&pageSize=25"),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.total).toBe(3);
    expect(body.items.map((item: { id: string }) => item.id)).toEqual([
      "without",
      "owned",
      "social",
    ]);
    expect(mocks.count).toHaveBeenCalledOnce();
  });
});

describe("GET /api/leads/stats website eligibility", () => {
  const businesses = [
    {
      website: null,
      isDemo: false,
      opportunityScore: 80,
      doNotContact: false,
      funnelStage: "novo",
      category: "Serviços",
      city: "Fortaleza",
      consents: [],
    },
    {
      website: "https://empresa.com.br",
      isDemo: false,
      opportunityScore: 50,
      doNotContact: false,
      funnelStage: "novo",
      category: "Serviços",
      city: "Fortaleza",
      consents: [],
    },
    {
      website: "https://instagram.com/empresa",
      isDemo: false,
      opportunityScore: 30,
      doNotContact: false,
      funnelStage: "novo",
      category: "Restaurantes",
      city: "Fortaleza",
      consents: [],
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getServerSession.mockResolvedValue({ user: { id: "user-1" } });
    mocks.findMany.mockResolvedValue(businesses);
    mocks.findSettings.mockResolvedValue({ leadGoal: 1000 });
  });

  it("uses the no-owned-site scope by default", async () => {
    const response = await GET_STATS(new Request("http://localhost/api/leads/stats"));
    const body = await response.json();

    expect(body).toMatchObject({ total: 2, realTotal: 2, high: 1, mid: 0, low: 1 });
  });

  it("uses the all-leads scope when explicitly requested", async () => {
    const response = await GET_STATS(
      new Request("http://localhost/api/leads/stats?includeWithWebsite=true"),
    );
    const body = await response.json();

    expect(body).toMatchObject({ total: 3, realTotal: 3, high: 1, mid: 1, low: 1 });
  });
});
