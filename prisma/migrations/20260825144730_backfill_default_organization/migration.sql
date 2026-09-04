-- Additive backfill kept separate because the domain migration may already be
-- applied in development. No existing user or legacy business is changed.
INSERT INTO "Organization" ("id", "name", "slug", "active", "createdAt", "updatedAt")
VALUES ('org_default', 'NOX OS', 'nox-os', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("slug") DO NOTHING;

WITH "organization" AS (
    SELECT "id" FROM "Organization" WHERE "slug" = 'nox-os' LIMIT 1
),
"chosenOwner" AS (
    (
        SELECT "id" FROM "User"
        WHERE lower("role") = 'admin'
        ORDER BY "createdAt" ASC, "id" ASC
        LIMIT 1
    )
    UNION ALL
    (
        SELECT "id" FROM "User"
        WHERE NOT EXISTS (SELECT 1 FROM "User" WHERE lower("role") = 'admin')
        ORDER BY "createdAt" ASC, "id" ASC
        LIMIT 1
    )
    LIMIT 1
)
INSERT INTO "OrganizationMembership" (
    "id", "organizationId", "userId", "role", "active", "createdAt", "updatedAt"
)
SELECT
    'membership_' || md5("User"."id" || "organization"."id"),
    "organization"."id",
    "User"."id",
    CASE
        WHEN "User"."id" = "chosenOwner"."id" THEN 'OWNER'
        WHEN lower("User"."role") = 'admin' THEN 'ADMIN'
        WHEN lower("User"."role") = 'operator' THEN 'OPERADOR'
        ELSE 'LEITOR'
    END,
    "User"."active",
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "User"
CROSS JOIN "organization"
LEFT JOIN "chosenOwner" ON true
ON CONFLICT ("organizationId", "userId") DO NOTHING;
