import bcrypt from "bcryptjs";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/authz/dal";
import { authorized } from "@/lib/authz/route";
import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/settings";

const schema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(12).max(128),
});

// Changing your own password needs a session, not a membership: it must keep
// working for an account that belongs to no organization yet.
export const POST = authorized(async (req: Request) => {
  const { userId } = await requireSession();

  const body = schema.safeParse(await req.json().catch(() => null));
  if (!body.success) {
    return NextResponse.json(
      { error: "A nova senha deve ter entre 12 e 128 caracteres." },
      { status: 400 },
    );
  }

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || !user.active) {
    return NextResponse.json({ error: "Conta não encontrada ou desativada." }, { status: 403 });
  }

  const currentMatches = await bcrypt.compare(body.data.currentPassword, user.passwordHash);
  if (!currentMatches) {
    return NextResponse.json({ error: "A senha atual está incorreta." }, { status: 400 });
  }

  const reusesCurrent = await bcrypt.compare(body.data.newPassword, user.passwordHash);
  if (reusesCurrent) {
    return NextResponse.json({ error: "A nova senha deve ser diferente da atual." }, { status: 400 });
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: await bcrypt.hash(body.data.newPassword, 12) },
  });
  await writeAudit({
    userId: user.id,
    action: "account.password.change",
    entity: "User",
    entityId: user.id,
  });

  return NextResponse.json({ ok: true });
});
