import bcrypt from "bcryptjs";
import { Prisma } from "@prisma/client";
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/settings";

const roleSchema = z.enum(["admin", "operator"]);

const createSchema = z.object({
  name: z.string().trim().min(2).max(100),
  email: z.string().trim().email().max(200),
  password: z.string().min(12).max(128),
  role: roleSchema.default("operator"),
});

const updateSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().trim().min(2).max(100).optional(),
    email: z.string().trim().email().max(200).optional(),
    password: z.string().min(12).max(128).optional(),
    role: roleSchema.optional(),
    active: z.boolean().optional(),
  })
  .refine(
    (value) =>
      value.name !== undefined ||
      value.email !== undefined ||
      value.password !== undefined ||
      value.role !== undefined ||
      value.active !== undefined,
    { message: "Nenhuma alteração informada." },
  );

async function adminActor() {
  const session = await getServerSession(authOptions);
  const user = session?.user;
  return user?.id && user.role === "admin" ? user : null;
}

const publicSelect = {
  id: true,
  name: true,
  email: true,
  role: true,
  active: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.UserSelect;

export async function GET() {
  const actor = await adminActor();
  if (!actor) return NextResponse.json({ error: "Acesso exclusivo de administrador." }, { status: 403 });

  const users = await prisma.user.findMany({
    select: publicSelect,
    orderBy: [{ active: "desc" }, { createdAt: "asc" }],
  });
  return NextResponse.json({ users, currentUserId: actor.id });
}

export async function POST(req: Request) {
  const actor = await adminActor();
  if (!actor) return NextResponse.json({ error: "Acesso exclusivo de administrador." }, { status: 403 });

  const body = createSchema.safeParse(await req.json().catch(() => null));
  if (!body.success) {
    return NextResponse.json(
      { error: "Informe nome, e-mail válido e senha com pelo menos 12 caracteres." },
      { status: 400 },
    );
  }

  const email = body.data.email.toLowerCase();
  const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (existing) return NextResponse.json({ error: "Este e-mail já está cadastrado." }, { status: 409 });

  const user = await prisma.user.create({
    data: {
      name: body.data.name,
      email,
      passwordHash: await bcrypt.hash(body.data.password, 12),
      role: body.data.role,
      active: true,
    },
    select: publicSelect,
  });
  await writeAudit({
    userId: actor.id,
    action: "user.create",
    entity: "User",
    entityId: user.id,
    meta: { email: user.email, role: user.role },
  });

  return NextResponse.json({ user }, { status: 201 });
}

export async function PATCH(req: Request) {
  const actor = await adminActor();
  if (!actor) return NextResponse.json({ error: "Acesso exclusivo de administrador." }, { status: 403 });

  const body = updateSchema.safeParse(await req.json().catch(() => null));
  if (!body.success) {
    return NextResponse.json({ error: "Alteração inválida." }, { status: 400 });
  }

  const target = await prisma.user.findUnique({ where: { id: body.data.id } });
  if (!target) return NextResponse.json({ error: "Usuário não encontrado." }, { status: 404 });

  if (target.id === actor.id && (body.data.active === false || body.data.role === "operator")) {
    return NextResponse.json(
      { error: "Você não pode desativar ou remover seu próprio acesso administrativo." },
      { status: 400 },
    );
  }

  const removesActiveAdmin =
    target.role === "admin" &&
    target.active &&
    (body.data.active === false || body.data.role === "operator");
  if (removesActiveAdmin) {
    const activeAdmins = await prisma.user.count({ where: { role: "admin", active: true } });
    if (activeAdmins <= 1) {
      return NextResponse.json(
        { error: "É necessário manter pelo menos um administrador ativo." },
        { status: 400 },
      );
    }
  }

  const email = body.data.email?.toLowerCase();
  if (email && email !== target.email) {
    const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (existing) {
      return NextResponse.json({ error: "Este e-mail já está cadastrado." }, { status: 409 });
    }
  }

  const update: Prisma.UserUpdateInput = {
    name: body.data.name,
    email,
    role: body.data.role,
    active: body.data.active,
  };
  if (body.data.password) update.passwordHash = await bcrypt.hash(body.data.password, 12);

  const user = await prisma.user.update({
    where: { id: target.id },
    data: update,
    select: publicSelect,
  });
  await writeAudit({
    userId: actor.id,
    action: "user.update",
    entity: "User",
    entityId: user.id,
    meta: {
      nameChanged: body.data.name !== undefined,
      emailChanged: body.data.email !== undefined,
      role: body.data.role,
      active: body.data.active,
      passwordReset: body.data.password !== undefined,
    },
  });

  return NextResponse.json({ user });
}
