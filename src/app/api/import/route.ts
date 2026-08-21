import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { runOverpassImportJob, upsertPlaces } from "@/lib/import-service";
import { parseCsvPlaces } from "@/lib/places/csv";
import { DEFAULT_RADII_KM } from "@/lib/funnel";
import { writeAudit } from "@/lib/settings";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const jobs = await prisma.importJob.findMany({
    orderBy: { createdAt: "desc" },
    take: 20,
  });
  return NextResponse.json({ jobs });
}

const startSchema = z.object({
  provider: z.enum(["overpass", "csv"]),
  lat: z.number().optional(),
  lng: z.number().optional(),
  label: z.string().optional(),
  categoryIds: z.array(z.string()).default([]),
  radiiKm: z.array(z.number()).optional(),
  csvText: z.string().optional(),
});

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = startSchema.safeParse(await req.json());
  if (!body.success) {
    return NextResponse.json({ error: body.error.flatten() }, { status: 400 });
  }

  const settings = await prisma.appSettings.findUnique({ where: { id: "default" } });
  const data = body.data;

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
        categories: JSON.stringify(data.categoryIds),
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
      userId: session.user.id,
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

  const job = await prisma.importJob.create({
    data: {
      provider: "overpass",
      status: "pending",
      originLat: data.lat,
      originLng: data.lng,
      originLabel: data.label,
      radiiKm: JSON.stringify(data.radiiKm ?? [...DEFAULT_RADII_KM]),
      categories: JSON.stringify(data.categoryIds),
    },
  });

  // Fire-and-forget background import (same process)
  void runOverpassImportJob(job.id);

  await writeAudit({
    userId: session.user.id,
    action: "import.overpass.start",
    entity: "ImportJob",
    entityId: job.id,
  });

  return NextResponse.json({ jobId: job.id, status: "started" });
}

const controlSchema = z.object({
  jobId: z.string(),
  action: z.enum(["pause", "resume", "cancel"]),
});

export async function PATCH(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = controlSchema.safeParse(await req.json());
  if (!body.success) {
    return NextResponse.json({ error: body.error.flatten() }, { status: 400 });
  }

  const job = await prisma.importJob.findUnique({ where: { id: body.data.jobId } });
  if (!job) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (body.data.action === "pause") {
    await prisma.importJob.update({
      where: { id: job.id },
      data: { status: "paused", pausedAt: new Date() },
    });
  } else if (body.data.action === "cancel") {
    await prisma.importJob.update({
      where: { id: job.id },
      data: { status: "cancelled", cancelledAt: new Date(), finishedAt: new Date() },
    });
  } else if (body.data.action === "resume") {
    await prisma.importJob.update({
      where: { id: job.id },
      data: { status: "pending", pausedAt: null },
    });
    void runOverpassImportJob(job.id);
  }

  return NextResponse.json({ ok: true });
}
