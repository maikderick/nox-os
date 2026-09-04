import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/authz/dal";
import { authorized } from "@/lib/authz/route";
import { z } from "zod";
import { prisma } from "@/lib/db";
import {
  normalizeImportRadii,
  runOverpassImportBurst,
  upsertPlaces,
} from "@/lib/import-service";
import { parseCsvPlaces } from "@/lib/places/csv";
import { writeAudit } from "@/lib/settings";
import { CATEGORY_GROUPS } from "@/lib/categories";
import { parseJsonArray } from "@/lib/utils";
import { waitUntil } from "@vercel/functions";

export const maxDuration = 300;

export const GET = authorized(async () => {
  await requirePermission("lead:read");

  await prisma.importJob.updateMany({
    where: {
      provider: "overpass",
      status: "processing",
      updatedAt: { lt: new Date(Date.now() - 6 * 60 * 1000) },
    },
    data: {
      status: "running",
      errorMessage: null,
      finishedAt: null,
    },
  });

  const jobs = await prisma.importJob.findMany({
    orderBy: { createdAt: "desc" },
    take: 20,
  });

  const readyJob = jobs.find(
    (job) => job.provider === "overpass" && ["pending", "running"].includes(job.status),
  );
  if (readyJob) waitUntil(runOverpassImportBurst(readyJob.id));

  return NextResponse.json({ jobs });
});

const startSchema = z.object({
  provider: z.enum(["overpass", "csv"]),
  lat: z.number().optional(),
  lng: z.number().optional(),
  label: z.string().optional(),
  categoryIds: z.array(z.string()).default([]),
  radiiKm: z.array(z.number().min(1).max(200)).optional(),
  csvText: z.string().optional(),
});

export const POST = authorized(async (req: Request) => {
  const actor = await requirePermission("lead:write");

  const body = startSchema.safeParse(await req.json());
  if (!body.success) {
    return NextResponse.json({ error: body.error.flatten() }, { status: 400 });
  }

  const settings = await prisma.appSettings.findUnique({ where: { id: "default" } });
  const data = body.data;
  const validCategoryIds = new Set(CATEGORY_GROUPS.map((group) => group.id));
  const configuredCategories = parseJsonArray(settings?.enabledCategories).filter((id) =>
    validCategoryIds.has(id),
  );
  const requestedCategories = data.categoryIds.filter((id) => validCategoryIds.has(id));
  const categories =
    requestedCategories.length > 0
      ? requestedCategories
      : configuredCategories.length > 0
        ? configuredCategories
        : CATEGORY_GROUPS.map((group) => group.id);

  if (data.provider === "csv") {
    if (!data.csvText) {
      return NextResponse.json({ error: "csvText obrigatório" }, { status: 400 });
    }
    const places = parseCsvPlaces(data.csvText);
    const origin =
      data.lat != null && data.lng != null
        ? { lat: data.lat, lng: data.lng }
        : settings?.originLat != null && settings.originLng != null
          ? { lat: settings.originLat, lng: settings.originLng }
          : null;

    const job = await prisma.importJob.create({
      data: {
        provider: "csv",
        status: "running",
        originLat: origin?.lat,
        originLng: origin?.lng,
        originLabel: data.label,
        categories: JSON.stringify(categories),
        startedAt: new Date(),
        foundCount: places.length,
      },
    });

    const stats = await upsertPlaces(
      places,
      origin,
      {
        franchisePenalty: settings?.franchisePenalty ?? 15,
        modernSitePenalty: settings?.modernSitePenalty ?? 20,
        staleDataPenalty: settings?.staleDataPenalty ?? 10,
        maxRadiusKm: settings?.maxRadiusKm ?? 80,
      },
      false,
    );

    await prisma.importJob.update({
      where: { id: job.id },
      data: {
        status: "completed",
        finishedAt: new Date(),
        acceptedCount: stats.accepted,
        duplicateCount: stats.duplicate,
        rejectedCount: stats.rejected,
        progressJson: JSON.stringify({ attribution: "CSV do usuário" }),
      },
    });

    await writeAudit({
      userId: actor.userId,
      action: "import.csv",
      entity: "ImportJob",
      entityId: job.id,
      meta: stats,
    });

    return NextResponse.json({ jobId: job.id, stats });
  }

  if (data.lat == null || data.lng == null) {
    return NextResponse.json({ error: "lat/lng obrigatórios para Overpass" }, { status: 400 });
  }

  // A second job would query the same free public service in parallel and make
  // overload errors more likely. Recover abandoned jobs, then reuse any active
  // collection instead of creating duplicates on repeated clicks.
  const staleBefore = new Date(Date.now() - 7 * 60 * 1000);
  await prisma.importJob.updateMany({
    where: {
      provider: "overpass",
      status: { in: ["pending", "running", "processing"] },
      updatedAt: { lt: staleBefore },
    },
    data: {
      status: "failed",
      finishedAt: new Date(),
      errorMessage: "A execução anterior foi interrompida. Inicie a coleta novamente.",
    },
  });

  const activeJob = await prisma.importJob.findFirst({
    where: {
      provider: "overpass",
      status: { in: ["pending", "running", "processing"] },
    },
    orderBy: { createdAt: "desc" },
    select: { id: true, status: true },
  });
  if (activeJob) {
    return NextResponse.json({
      jobId: activeJob.id,
      status: "already_running",
    });
  }

  const job = await prisma.importJob.create({
    data: {
      provider: "overpass",
      status: "pending",
      originLat: data.lat,
      originLng: data.lng,
      originLabel: data.label,
      radiiKm: JSON.stringify(
        normalizeImportRadii(
          data.radiiKm,
          settings?.initialRadiusKm ?? 5,
          settings?.maxRadiusKm ?? 80,
        ),
      ),
      categories: JSON.stringify(categories),
    },
  });

  await prisma.appSettings.updateMany({
    where: { id: "default" },
    data: {
      originLat: data.lat,
      originLng: data.lng,
      originLabel: data.label,
    },
  });

  // Work in a bounded burst. Progress polling safely starts a later burst when
  // more checkpoints remain, avoiding recursive requests and Vercel HTTP 508.
  waitUntil(runOverpassImportBurst(job.id));

  await writeAudit({
    userId: actor.userId,
    action: "import.overpass.start",
    entity: "ImportJob",
    entityId: job.id,
  });

  return NextResponse.json({ jobId: job.id, status: "started" });
});

const controlSchema = z.object({
  jobId: z.string(),
  action: z.enum(["pause", "resume", "cancel"]),
});

export const PATCH = authorized(async (req: Request) => {
  await requirePermission("lead:write");

  const body = controlSchema.safeParse(await req.json());
  if (!body.success) {
    return NextResponse.json({ error: body.error.flatten() }, { status: 400 });
  }

  const job = await prisma.importJob.findUnique({ where: { id: body.data.jobId } });
  if (!job) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (body.data.action === "pause") {
    const result = await prisma.importJob.updateMany({
      where: { id: job.id, status: { in: ["pending", "running", "processing"] } },
      data: { status: "paused", pausedAt: new Date() },
    });
    if (result.count === 0) {
      return NextResponse.json({ error: "Este job não está em execução." }, { status: 409 });
    }
  } else if (body.data.action === "cancel") {
    const result = await prisma.importJob.updateMany({
      where: { id: job.id, status: { notIn: ["completed", "cancelled"] } },
      data: { status: "cancelled", cancelledAt: new Date(), finishedAt: new Date() },
    });
    if (result.count === 0) {
      return NextResponse.json({ error: "Este job já foi encerrado." }, { status: 409 });
    }
  } else if (body.data.action === "resume") {
    const otherActiveJob = await prisma.importJob.findFirst({
      where: {
        id: { not: job.id },
        provider: "overpass",
        status: { in: ["pending", "running", "processing"] },
      },
      select: { id: true },
    });
    if (otherActiveJob) {
      return NextResponse.json(
        { error: "Já existe outra coleta em andamento. Pause ou cancele-a antes de continuar." },
        { status: 409 },
      );
    }

    const staleBefore = new Date(Date.now() - 4 * 60 * 1000);
    const result = await prisma.importJob.updateMany({
      where: {
        id: job.id,
        OR: [
          { status: { in: ["paused", "failed"] } },
          { status: { in: ["running", "processing"] }, updatedAt: { lt: staleBefore } },
        ],
      },
      data: {
        status: "pending",
        pausedAt: null,
        finishedAt: null,
        errorMessage: null,
      },
    });
    if (result.count === 0) {
      return NextResponse.json(
        { error: "O job já está rodando ou não pode ser retomado." },
        { status: 409 },
      );
    }
    waitUntil(runOverpassImportBurst(job.id));
  }

  return NextResponse.json({ ok: true });
});
